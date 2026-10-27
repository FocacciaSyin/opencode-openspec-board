import { execFile } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs"
import { dirname, join, resolve } from "node:path"

export type Task = {
  id: string
  title: string
  done: boolean
}

export type Change = {
  name: string
  tasks: Task[]
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
    return hasOpenSpec(dir) ? { unresolved: "OpenSpec context 回傳無效的 JSON" } : null
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
// CLI 冷啟動可能超過五秒，不能把正常但較慢的 root 偵測提早終止。
export function runContext(dir: string, timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "openspec",
      ["context", "--json"],
      { cwd: dir, shell: true, timeout, windowsHide: true },
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
    return hasOpenSpec(dir)
      ? { unresolved: "OpenSpec root 偵測失敗，請確認 openspec context --json 可正常執行" }
      : null
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
      // 否定結果是當下檔案狀態的函式，專案可能接著才初始化，所以不快取。
      if (result !== null && !("unresolved" in result)) cache.set(dir, result)
      return result
    },
    forget(dir) {
      cache.delete(dir)
    },
  }
}

/**
 * 綁定 fs.watch：目標不存在時退到最近存在的上層目錄，目標出現後才改成遞迴監看目標。
 * 只在綁定路徑改變時重綁，避免每次存檔都重建 watcher。
 * shortcut: 被監看的目錄本身被刪除時 Windows 的 fs.watch 不一定發事件，等真的回報再處理。
 */
function watchNearest(target: string, onChange: () => void): () => void {
  let watcher: FSWatcher | undefined
  let bound = ""
  let timer: ReturnType<typeof setTimeout> | undefined

  const nearest = (path: string): string | undefined => {
    let current = resolve(path)
    for (;;) {
      if (existsSync(current)) return current
      const parent = dirname(current)
      if (parent === current) return undefined
      current = parent
    }
  }

  const bind = () => {
    const next = nearest(target) ?? ""
    if (next === bound) return
    watcher?.close()
    watcher = undefined
    bound = next
    if (!next) return
    try {
      watcher = watch(next, { recursive: next === resolve(target) }, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = undefined
          bind()
          onChange()
        }, 150)
      })
      watcher.on("error", () => {})
    } catch {
      watcher = undefined
      bound = ""
    }
  }

  bind()

  return () => {
    if (timer) clearTimeout(timer)
    watcher?.close()
  }
}

/** 只在 config.yaml/config.yml 或 openspec/ 本身出現／消失時通知，避免 tasks.md 的勾選也觸發重新解析。 */
export function watchConfig(dir: string, onChange: () => void): () => void {
  const configDir = join(dir, "openspec")
  const stampOf = () => {
    for (const name of ["config.yaml", "config.yml"]) {
      try {
        return String(statSync(join(configDir, name)).mtimeMs)
      } catch {}
    }
    return existsSync(configDir) ? "dir" : ""
  }

  let stamp = stampOf()
  return watchNearest(configDir, () => {
    const next = stampOf()
    if (next === stamp) return
    stamp = next
    onChange()
  })
}

/** 監看 changes 目錄，150ms debounce；目錄後建也會接上。回傳卸載函式。 */
export function watchBoard(dir: string, onChange: () => void): () => void {
  return watchNearest(join(dir, "openspec", "changes"), onChange)
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
    const next = tasks.find((task) => !task.done)
    changes.push({
      name: entry.name,
      tasks,
      done,
      total: tasks.length,
      ...(next ? { next } : {}),
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

/** GUI 的資料來源綁定單一 location；首次讀取才監看，卸載後不再建立 watcher。 */
// GUI 初讀會與 server 啟動競爭 I/O，容許 CLI 冷啟動；TUI 保留原本 5 秒上限。
export function createBoardSource(dir: string, changed: () => void, run: ContextRunner = (target) => runContext(target, 15000)) {
  const resolver = createRootResolver(run)
  let state: BoardState = { kind: "no-openspec" }
  let rootPath: string | undefined
  let stopConfig: (() => void) | undefined
  let stopChanges: (() => void) | undefined
  let revision = 0
  let disposed = false
  let latestRead: Promise<BoardState>

  const read = (refresh = false): Promise<BoardState> => {
    if (disposed) return Promise.resolve(state)
    stopConfig ??= watchConfig(dir, () => {
      void read(true).then(() => { if (!disposed) changed() })
    })
    if (refresh) resolver.forget(dir)
    const request = ++revision
    latestRead = resolver.resolve(dir).then((root): BoardState | Promise<BoardState> => {
      if (disposed) return state
      // 多視窗或事件同時讀取時，舊請求須等待新結果，不能回傳過期快取供操作使用。
      if (request !== revision) return latestRead
      if (root === undefined) return state

      const nextPath = root && "path" in root ? root.path : undefined
      if (rootPath !== nextPath) {
        stopChanges?.()
        stopChanges = nextPath ? watchBoard(nextPath, changed) : undefined
        rootPath = nextPath
      }
      state = root === null
        ? { kind: "no-openspec" }
        : "unresolved" in root
          ? { kind: "unresolved", message: root.unresolved }
          : loadBoard(root.path)
      return state
    })
    return latestRead
  }

  return {
    read,
    dispose() {
      disposed = true
      revision++
      stopConfig?.()
      stopChanges?.()
    },
  }
}

export function formatFooter(state: BoardState): string | undefined {
  if (state.kind === "unresolved") return "openspec ?"
  if (state.kind !== "ready") return undefined
  return `openspec ${state.done}/${state.total} (${state.changes.length})`
}

export function previewTasks(change: Change, expanded: boolean): Task[] {
  return expanded ? change.tasks : change.tasks.slice(0, 3)
}

/** 存檔保留仍存在的 change；清空專案狀態時一併重設展開清單。 */
export function retainExpanded(expanded: ReadonlySet<string>, state: BoardState): Set<string> {
  const names = new Set(state.kind === "ready" ? state.changes.map((change) => change.name) : [])
  return new Set([...expanded].filter((name) => names.has(name)))
}

/** 單張 change 沒有 next 時要顯示的文案。 */
export function emptyLabel(change: Change): string | undefined {
  if (change.total === 0) return "尚無任務，用 openspec-propose"
  if (change.done === change.total) return "已完成，按 x 封存"
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
