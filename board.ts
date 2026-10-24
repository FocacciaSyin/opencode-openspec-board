import { execFile } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs"
import { join } from "node:path"

export type Task = {
  id: string
  title: string
  done: boolean
}

export type Change = {
  name: string
  done: number
  total: number
  next?: Task
  mtime: number
}

export type BoardState =
  | { kind: "no-openspec" }
  | { kind: "unresolved"; message: string }
  | { kind: "no-changes" }
  | { kind: "ready"; changes: Change[]; done: number; total: number }

/** 解析結果：null 代表這個目錄根本不是 OpenSpec 專案。 */
export type ResolvedRoot = { path: string; storeId?: string } | { unresolved: string } | null

export type ContextRunner = (dir: string) => Promise<string>

/** 解析 tasks.md 的核取方塊；id 沿用 OpenSpec 的 `1.1` 格式。 */
export function parseTasks(markdown: string): Task[] {
  const tasks: Task[] = []
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^-\s*\[([^\]]*)\]\s+(\S+)\s+(.*)$/.exec(line)
    if (!match) continue
    tasks.push({
      id: match[2],
      title: match[3].trim(),
      done: match[1].trim().toLowerCase() === "x",
    })
  }
  return tasks
}

export function hasOpenSpec(dir: string): boolean {
  return existsSync(join(dir, "openspec"))
}

/** 解析 `openspec context --json`；root 為 null 時要區分「非 OpenSpec 專案」與「宣告錯誤」。 */
export function parseContext(dir: string, stdout: string): ResolvedRoot {
  let payload: unknown
  try {
    payload = JSON.parse(stdout)
  } catch {
    return null
  }

  const data = payload as {
    root?: { path?: unknown; store_id?: unknown } | null
    status?: Array<{ message?: unknown }>
  }

  const path = data?.root?.path
  if (typeof path === "string" && path.length > 0) {
    const storeId = data.root?.store_id
    return typeof storeId === "string" && storeId.length > 0 ? { path, storeId } : { path }
  }

  // 沒有 openspec/ 的專案到處都是，不要在那裡顯示問號。
  if (!hasOpenSpec(dir)) return null

  const message = (data?.status ?? []).find((entry) => typeof entry?.message === "string")?.message
  return { unresolved: typeof message === "string" ? message : "無法解析 OpenSpec root" }
}

/** 預設 runner；Windows 的 openspec 是 .cmd，必須經 shell。root: null 也是 exit 1，所以看 stdout 不看 exit code。 */
export function runContext(dir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "openspec",
      ["context", "--json"],
      { cwd: dir, shell: true, timeout: 5000, windowsHide: true },
      (error, stdout) => {
        if (stdout && stdout.trim().length > 0) resolve(stdout)
        else reject(error ?? new Error("openspec context 沒有輸出"))
      },
    )
  })
}

export async function resolveRoot(dir: string, run: ContextRunner = runContext): Promise<ResolvedRoot> {
  try {
    return parseContext(dir, await run(dir))
  } catch {
    return null
  }
}

export type RootResolver = {
  /** 被較新的解析取代時回傳 undefined，呼叫端應直接忽略。 */
  resolve: (dir: string) => Promise<ResolvedRoot | undefined>
  forget: (dir: string) => void
}

/** 依目錄快取；同時只採納最後一次解析，避免切換專案時舊結果覆蓋新結果。 */
export function createRootResolver(run: ContextRunner = runContext): RootResolver {
  const cache = new Map<string, ResolvedRoot>()
  let latest = 0

  return {
    async resolve(dir) {
      if (cache.has(dir)) return cache.get(dir)
      const request = ++latest
      const result = await resolveRoot(dir, run)
      if (request !== latest) return undefined
      cache.set(dir, result)
      return result
    },
    forget(dir) {
      cache.delete(dir)
    },
  }
}

/** 只在 config.yaml/config.yml 變動時通知，避免 tasks.md 的勾選也觸發重新解析。 */
export function watchConfig(dir: string, onChange: () => void): () => void {
  const configDir = join(dir, "openspec")
  const stampOf = () => {
    for (const name of ["config.yaml", "config.yml"]) {
      try {
        return String(statSync(join(configDir, name)).mtimeMs)
      } catch {}
    }
    return ""
  }

  let stamp = stampOf()
  let watcher: FSWatcher | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    watcher = watch(configDir, { recursive: true }, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        const next = stampOf()
        if (next === stamp) return
        stamp = next
        onChange()
      }, 150)
    })
    watcher.on("error", () => {})
  } catch {
    watcher = undefined
  }

  return () => {
    if (timer) clearTimeout(timer)
    watcher?.close()
  }
}

/** 監看 changes 目錄，150ms debounce；回傳卸載函式。 */
export function watchBoard(dir: string, onChange: () => void): () => void {
  const target = join(dir, "openspec", "changes")
  let watcher: FSWatcher | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    watcher = watch(target, { recursive: true }, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        onChange()
      }, 150)
    })
    watcher.on("error", () => {})
  } catch {
    watcher = undefined
  }

  return () => {
    if (timer) clearTimeout(timer)
    watcher?.close()
  }
}

export function loadBoard(dir: string): BoardState {
  if (!hasOpenSpec(dir)) return { kind: "no-openspec" }

  const changesDir = join(dir, "openspec", "changes")
  let entries
  try {
    entries = readdirSync(changesDir, { withFileTypes: true })
  } catch {
    return { kind: "no-changes" }
  }

  const changes: Change[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "archive" || entry.name.startsWith(".")) continue

    const root = join(changesDir, entry.name)
    const file = join(root, "tasks.md")
    let tasks: Task[] = []
    try {
      tasks = parseTasks(readFileSync(file, "utf8"))
    } catch {
      tasks = []
    }

    let mtime = 0
    try {
      mtime = statSync(file).mtimeMs
    } catch {
      try {
        mtime = statSync(root).mtimeMs
      } catch {}
    }

    const done = tasks.filter((task) => task.done).length
    changes.push({
      name: entry.name,
      done,
      total: tasks.length,
      next: tasks.find((task) => !task.done),
      mtime,
    })
  }

  if (changes.length === 0) return { kind: "no-changes" }

  changes.sort((left, right) => right.mtime - left.mtime || left.name.localeCompare(right.name))
  return {
    kind: "ready",
    changes,
    done: changes.reduce((sum, change) => sum + change.done, 0),
    total: changes.reduce((sum, change) => sum + change.total, 0),
  }
}

export function formatFooter(state: BoardState): string | undefined {
  if (state.kind === "unresolved") return "openspec ?"
  if (state.kind !== "ready") return undefined
  return `openspec ${state.done}/${state.total} (${state.changes.length})`
}

/** 單張 change 沒有 next 時要顯示的文案。 */
export function emptyLabel(change: Change): string | undefined {
  if (change.total === 0) return "尚無任務，跑 /opsx-propose"
  if (change.done === change.total) return "已完成，可 /opsx-archive"
  return undefined
}

export function scopedArgs(change: Change): string | undefined {
  return change.next ? `${change.name} 只做 ${change.next.id}` : undefined
}

export function stepIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return 0
  return (current + delta + count) % count
}

/** 面板動作對應的 OpenSpec skill。 */
export const SKILLS = {
  apply: "openspec-apply-change",
  archive: "openspec-archive-change",
  update: "openspec-update-change",
} as const

export type DispatchOptions = {
  change: Change
  scope: "next" | "all" | "archive" | "update"
  send: (skill: string, text: string) => Promise<void>
  notify: (message: string, variant: "success" | "warning") => void
}

/** 以 skill 觸發動作；失敗時退回顯示 skill 名稱與參數。 */
export async function dispatchAction(options: DispatchOptions): Promise<boolean> {
  const skill =
    options.scope === "archive" ? SKILLS.archive : options.scope === "update" ? SKILLS.update : SKILLS.apply
  const text = options.scope === "next" ? scopedArgs(options.change) : options.change.name
  if (!text) {
    options.notify("沒有未完成任務", "warning")
    return false
  }

  try {
    await options.send(skill, text)
    options.notify(`已送出 ${skill} ${text}`, "success")
    return true
  } catch {
    options.notify(`${skill} ${text}`, "warning")
    return false
  }
}
