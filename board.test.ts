import { strict as assert } from "node:assert"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, test } from "node:test"
import {
  createRootResolver,
  dispatchAction,
  emptyLabel,
  formatFooter,
  loadBoard,
  parseContext,
  parseTasks,
  previewTasks,
  retainExpanded,
  resolveRoot,
  scopedArgs,
  startsTaskGroup,
  stepIndex,
  watchBoard,
  watchConfig,
  type Change,
  type BoardState,
} from "./board.ts"

function change(name: string, total: number, done = 0): Change {
  const tasks = Array.from({ length: total }, (_, index) => ({
    id: `1.${index + 1}`,
    title: `task ${index + 1}`,
    done: index < done,
  }))
  return { name, tasks, total, done, next: tasks.find((task) => !task.done), mtime: 0 }
}

describe("parseTasks", () => {
  test("reads checked and unchecked tasks with ids", () => {
    const tasks = parseTasks("- [ ] 1.1 第一個\n- [x] 1.2 第二個\n- [X] 1.3 第三個")
    assert.deepEqual(tasks.map((task) => [task.id, task.done]), [["1.1", false], ["1.2", true], ["1.3", true]])
  })

  test("ignores headings, bullets without checkboxes and workflow follow-up", () => {
    const tasks = parseTasks("## 1. 群組\n- 不是任務\n- [ ] 2.1 真任務\n- 專案審查通過後封存")
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0].id, "2.1")
  })
})

describe("loadBoard", () => {
  let root = ""

  before(() => {
    root = mkdtempSync(join(tmpdir(), "openspec-board-"))
  })

  after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test("no openspec directory", () => {
    assert.equal(loadBoard(join(root, "empty")).kind, "no-openspec")
  })

  test("openspec without changes", () => {
    const dir = join(root, "no-changes")
    mkdirSync(join(dir, "openspec", "changes"), { recursive: true })
    assert.equal(loadBoard(dir).kind, "no-changes")
  })

  // 同次讀取保留所有任務的順序與完成狀態供 TUI／GUI 顯示，且不改變進度、下一項與封存排除行為。
  test("counts tasks, finds next and skips archive", () => {
    const dir = join(root, "project")
    const changes = join(dir, "openspec", "changes")
    mkdirSync(join(changes, "alpha"), { recursive: true })
    mkdirSync(join(changes, "beta"), { recursive: true })
    mkdirSync(join(changes, "archive", "old"), { recursive: true })
    mkdirSync(join(changes, "draft"), { recursive: true })
    writeFileSync(join(changes, "alpha", "tasks.md"), "- [ ] 1.1 a\n- [x] 1.2 b\n- [ ] 1.3 c\n")
    writeFileSync(join(changes, "beta", "tasks.md"), "- [x] 2.1 done\n")
    writeFileSync(join(changes, "archive", "old", "tasks.md"), "- [ ] 9.9 ignored\n")

    const state = loadBoard(dir)
    assert.equal(state.kind, "ready")
    if (state.kind !== "ready") return
    assert.equal(state.changes.length, 3)
    assert.equal(state.done, 2)
    assert.equal(state.total, 4)

    const alpha = state.changes.find((item) => item.name === "alpha")
    assert.equal(alpha?.done, 1)
    assert.equal(alpha?.total, 3)
    assert.equal(alpha?.next?.id, "1.1")
    assert.equal(scopedArgs(alpha!), "alpha 只做 1.1")
    assert.deepEqual(alpha?.tasks, [
      { id: "1.1", title: "a", done: false },
      { id: "1.2", title: "b", done: true },
      { id: "1.3", title: "c", done: false },
    ])

    const beta = state.changes.find((item) => item.name === "beta")
    assert.equal(emptyLabel(beta!), "已完成，按 x 封存")
    assert.deepEqual(beta?.tasks, [{ id: "2.1", title: "done", done: true }])
    // RPC 在 JSON 編碼前驗證，不能保留 next: undefined。
    assert.equal(Object.hasOwn(beta!, "next"), false)

    const draft = state.changes.find((item) => item.name === "draft")
    assert.equal(emptyLabel(draft!), "尚無任務，用 openspec-propose")
    assert.deepEqual(draft?.tasks, [])
    assert.equal(Object.hasOwn(draft!, "next"), false)
  })
})

describe("board tasks", () => {
  // 預覽依原始順序取前三個，已完成任務與長標題不被篩除或截斷。
  test("previews the first three tasks including completed tasks", () => {
    const item = change("alpha", 5, 2)
    item.tasks[0].title = "很長的中文任務與 C:/very/long/path/without/spaces ".repeat(10)
    const original = structuredClone(item)
    assert.deepEqual(previewTasks(item, false), item.tasks.slice(0, 3))
    assert.deepEqual(previewTasks(item, false).map((task) => task.done), [true, true, false])
    assert.deepEqual(previewTasks(item, true), item.tasks)
    assert.deepEqual(item, original)
  })

  // 零至三項不遺漏，四項以上只限制預覽數；全部完成仍能展開閱讀。
  test("previews zero to five tasks even when all are completed", () => {
    for (let total = 0; total <= 5; total++) {
      const item = change("alpha", total, total)
      assert.equal(previewTasks(item, false).length, Math.min(3, total))
      assert.deepEqual(previewTasks(item, true), item.tasks)
      assert.equal(item.total - previewTasks(item, false).length, Math.max(0, total - 3))
    }
  })

  // 大項編號改變時才分段：首項與同大項不留白，1.x 接 2.1、2.x 接 10.1 都視為新大項。
  test("starts a new group only when the major task number changes", () => {
    const tasks = parseTasks("- [x] 1.1 a\n- [x] 1.2 b\n- [ ] 2.1 c\n- [ ] 2.2 d\n- [ ] 10.1 e")
    assert.deepEqual(tasks.map((_, index) => startsTaskGroup(tasks, index)), [false, false, true, false, true])
    assert.equal(startsTaskGroup(tasks, 5), false)
  })

  const ready = (...changes: Change[]): BoardState => ({ kind: "ready", changes, done: 0, total: 0 })

  // 每張 change 狀態獨立，重新讀取、排序與縮減任務不改變仍存在的展開意圖。
  test("retains expansion by name across reloads reorder and task count changes", () => {
    const expanded = new Set(["alpha"])
    const reloaded = retainExpanded(expanded, ready(change("beta", 5), change("alpha", 2)))
    assert.deepEqual([...reloaded], ["alpha"])
    assert.equal(reloaded.has("beta"), false)
    assert.deepEqual([...retainExpanded(reloaded, ready(change("alpha", 6), change("beta", 5)))], ["alpha"])
    assert.deepEqual([...expanded], ["alpha"])
  })

  // 封存／刪除立即清理，重新建立同名 change 時不能帶回舊狀態。
  test("forgets removed changes before a same-name change is recreated", () => {
    const remaining = retainExpanded(new Set(["alpha", "beta"]), ready(change("beta", 5)))
    assert.deepEqual([...remaining], ["beta"])
    assert.deepEqual([...retainExpanded(remaining, ready(change("alpha", 5), change("beta", 5)))], ["beta"])
  })

  // 專案切換先清空 state；所有非 ready 狀態均重設，避免跨專案同名 change 混用。
  test("resets expansion when project state is cleared or unavailable", () => {
    const states: BoardState[] = [
      { kind: "no-openspec" },
      { kind: "no-changes" },
      { kind: "unresolved", message: "Unknown store" },
    ]
    for (const state of states) {
      const cleared = retainExpanded(new Set(["alpha"]), state)
      assert.equal(cleared.size, 0)
      assert.equal(retainExpanded(cleared, ready(change("alpha", 5))).size, 0)
    }
  })
})

describe("parseContext", () => {
  let root = ""

  before(() => {
    root = mkdtempSync(join(tmpdir(), "openspec-context-"))
  })

  after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const project = (name: string, withOpenSpec: boolean) => {
    const dir = join(root, name)
    mkdirSync(withOpenSpec ? join(dir, "openspec") : dir, { recursive: true })
    return dir
  }

  test("local root", () => {
    const dir = project("local", true)
    assert.deepEqual(parseContext(dir, JSON.stringify({ root: { path: dir, source: "nearest" } })), { path: dir })
  })

  test("store root keeps the store id", () => {
    const dir = project("store", true)
    const store = join(root, "store-specs")
    assert.deepEqual(
      parseContext(dir, JSON.stringify({ root: { path: store, source: "declared", store_id: "demo" } })),
      { path: store, storeId: "demo" },
    )
  })

  test("unregistered store becomes unresolved with the CLI message", () => {
    const dir = project("bad-store", true)
    const message = "Unknown store 'nope'."
    assert.deepEqual(parseContext(dir, JSON.stringify({ root: null, status: [{ code: "unknown_store", message }] })), {
      unresolved: message,
    })
  })

  test("directory without openspec stays hidden", () => {
    const dir = project("plain", false)
    assert.equal(parseContext(dir, JSON.stringify({ root: null, status: [{ message: "none" }] })), null)
  })

  // 已有 OpenSpec 的專案遇到無效輸出時，必須顯示偵測失敗，不得誤報專案不存在。
  test("invalid JSON in an OpenSpec project reports a detection failure", () => {
    assert.deepEqual(parseContext(project("broken-json", true), "not json"), {
      unresolved: "OpenSpec context 回傳無效的 JSON",
    })
  })

  // 真正沒有 OpenSpec 的一般目錄，仍不因 CLI 輸出異常顯示提示。
  test("invalid JSON without an OpenSpec directory stays hidden", () => {
    assert.equal(parseContext(project("plain-broken-json", false), "not json"), null)
  })
})

describe("resolveRoot", () => {
  let root = ""
  before(() => { root = mkdtempSync(join(tmpdir(), "openspec-runner-")) })
  after(() => { rmSync(root, { recursive: true, force: true }) })

  // CLI 不可用時，非 OpenSpec 專案仍保持隱藏。
  test("runner failure stays hidden without an OpenSpec directory", async () => {
    assert.equal(await resolveRoot(root, async () => { throw new Error("missing") }), null)
  })

  // 真實逾時與找不到 CLI 都會拒絕 Promise；已有 OpenSpec 時兩者都必須顯示失敗。
  test("runner failure reports unresolved for an existing OpenSpec project", async () => {
    const dir = join(root, "project")
    mkdirSync(join(dir, "openspec"), { recursive: true })
    const failures = [new Error("spawn openspec ENOENT"), Object.assign(new Error("Command failed"), { killed: true, signal: "SIGTERM" })]
    for (const failure of failures) {
      assert.deepEqual(await resolveRoot(dir, async () => { throw failure }), {
        unresolved: "OpenSpec root 偵測失敗，請確認 openspec context --json 可正常執行",
      })
    }
  })
})

describe("createRootResolver", () => {
  test("caches per directory and forget re-runs", async () => {
    let calls = 0
    const resolver = createRootResolver(async (dir) => {
      calls += 1
      return JSON.stringify({ root: { path: dir } })
    })

    assert.deepEqual(await resolver.resolve("/a"), { path: "/a" })
    assert.deepEqual(await resolver.resolve("/a"), { path: "/a" })
    assert.equal(calls, 1)

    resolver.forget("/a")
    await resolver.resolve("/a")
    assert.equal(calls, 2)
  })

  test("does not cache a missing root", async () => {
    let calls = 0
    const resolver = createRootResolver(async () => {
      calls += 1
      return JSON.stringify({ root: null })
    })

    assert.equal(await resolver.resolve("/missing"), null)
    assert.equal(await resolver.resolve("/missing"), null)
    assert.equal(calls, 2, "a missing root must be resolved again")
  })

  test("does not cache an unresolved store", async () => {
    const dir = mkdtempSync(join(tmpdir(), "openspec-unresolved-"))
    mkdirSync(join(dir, "openspec"), { recursive: true })

    let calls = 0
    const resolver = createRootResolver(async () => {
      calls += 1
      return JSON.stringify({ root: null, status: [{ message: "Unknown store 'nope'." }] })
    })

    const first = await resolver.resolve(dir)
    assert.ok(first !== null && "unresolved" in first)
    await resolver.resolve(dir)
    assert.equal(calls, 2, "an unresolved root must be resolved again")
    rmSync(dir, { recursive: true, force: true })
  })

  test("a slower earlier request does not win", async () => {
    const pending = new Map<string, (value: string) => void>()
    const resolver = createRootResolver((dir) => new Promise((resolve) => pending.set(dir, resolve)))

    const first = resolver.resolve("/slow")
    const second = resolver.resolve("/fast")

    pending.get("/fast")!(JSON.stringify({ root: { path: "/fast" } }))
    assert.deepEqual(await second, { path: "/fast" })

    pending.get("/slow")!(JSON.stringify({ root: { path: "/slow" } }))
    assert.equal(await first, undefined)
  })
})

describe("stepIndex", () => {
  test("wraps in both directions", () => {
    assert.equal(stepIndex(0, 1, 3), 1)
    assert.equal(stepIndex(2, 1, 3), 0)
    assert.equal(stepIndex(0, -1, 3), 2)
    assert.equal(stepIndex(1, -1, 3), 0)
  })

  test("stays at zero without changes", () => {
    assert.equal(stepIndex(5, 1, 0), 0)
  })
})

describe("watchBoard", () => {
  test("notifies after a change and stops after dispose", async () => {
    const dir = mkdtempSync(join(tmpdir(), "openspec-watch-"))
    const changeDir = join(dir, "openspec", "changes", "one")
    mkdirSync(changeDir, { recursive: true })
    const file = join(changeDir, "tasks.md")
    writeFileSync(file, "- [ ] 1.1 a\n")

    let calls = 0
    const stop = watchBoard(dir, () => {
      calls += 1
    })

    writeFileSync(file, "- [x] 1.1 a\n")
    await new Promise((resolve) => setTimeout(resolve, 800))
    assert.ok(calls >= 1, "watcher should notify after a change")

    stop()
    const afterStop = calls
    writeFileSync(file, "- [ ] 1.1 a\n")
    await new Promise((resolve) => setTimeout(resolve, 400))
    assert.equal(calls, afterStop, "watcher should stop after dispose")

    rmSync(dir, { recursive: true, force: true })
  })
})

describe("watchConfig", () => {
  test("notifies when openspec appears after attach", async () => {
    const dir = mkdtempSync(join(tmpdir(), "openspec-late-config-"))
    let calls = 0
    const stop = watchConfig(dir, () => {
      calls += 1
    })

    mkdirSync(join(dir, "openspec"), { recursive: true })
    await new Promise((resolve) => setTimeout(resolve, 800))
    assert.ok(calls >= 1, "watcher should notice a new openspec directory")

    stop()
    const afterStop = calls
    writeFileSync(join(dir, "openspec", "config.yaml"), "schema: spec-driven\n")
    await new Promise((resolve) => setTimeout(resolve, 400))
    assert.equal(calls, afterStop, "watcher should stop after dispose")

    rmSync(dir, { recursive: true, force: true })
  })
})

describe("watchBoard late directories", () => {
  test("re-attaches when the changes directory appears after attach", async () => {
    const dir = mkdtempSync(join(tmpdir(), "openspec-late-board-"))
    mkdirSync(join(dir, "openspec"), { recursive: true })

    let calls = 0
    const stop = watchBoard(dir, () => {
      calls += 1
    })

    const changeDir = join(dir, "openspec", "changes", "one")
    mkdirSync(changeDir, { recursive: true })
    const file = join(changeDir, "tasks.md")
    writeFileSync(file, "- [ ] 1.1 a\n")
    await new Promise((resolve) => setTimeout(resolve, 800))
    assert.ok(calls >= 1, "watcher should notice a new changes directory")
    assert.equal(loadBoard(dir).kind, "ready")

    const attached = calls
    writeFileSync(file, "- [x] 1.1 a\n")
    await new Promise((resolve) => setTimeout(resolve, 800))
    assert.ok(calls > attached, "watcher should re-attach to the new changes directory")

    stop()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("formatFooter", () => {
  test("hides when there is nothing to show", () => {
    assert.equal(formatFooter({ kind: "no-openspec" }), undefined)
    assert.equal(formatFooter({ kind: "no-changes" }), undefined)
    assert.equal(formatFooter({ kind: "unresolved", message: "Unknown store" }), "openspec ?")
  })

  test("formats progress", () => {
    assert.equal(formatFooter({ kind: "ready", changes: [change("a", 15), change("b", 18)], done: 2, total: 33 }), "openspec 2/33 (2)")
  })
})

describe("dispatchAction", () => {
  test("sends the scoped request through a skill", async () => {
    const calls: string[][] = []
    const ok = await dispatchAction({
      change: change("alpha", 2),
      scope: "next",
      send: async (name, text) => {
        calls.push([name, text])
      },
      notify: () => {},
    })
    assert.equal(ok, true)
    assert.deepEqual(calls, [["openspec-apply-change", "alpha 只做 1.1"]])
  })

  test("falls back to the skill name when sending fails", async () => {
    const notes: string[] = []
    const ok = await dispatchAction({
      change: change("beta", 3),
      scope: "all",
      send: async () => {
        throw new Error("unavailable")
      },
      notify: (message) => notes.push(message),
    })
    assert.equal(ok, false)
    assert.deepEqual(notes, ["openspec-apply-change beta"])
  })

  test("does not send when there is no next task", async () => {
    const notes: string[] = []
    const ok = await dispatchAction({
      change: change("gamma", 1, 1),
      scope: "next",
      send: async () => {},
      notify: (message) => notes.push(message),
    })
    assert.equal(ok, false)
    assert.deepEqual(notes, ["沒有未完成任務"])
  })

  test("sends the update skill", async () => {
    const calls: string[][] = []
    const ok = await dispatchAction({
      change: change("alpha", 2),
      scope: "update",
      send: async (name, text) => {
        calls.push([name, text])
      },
      notify: () => {},
    })
    assert.equal(ok, true)
    assert.deepEqual(calls, [["openspec-update-change", "alpha"]])
  })

  test("sends the archive skill", async () => {
    const calls: string[][] = []
    const ok = await dispatchAction({
      change: change("done", 2, 2),
      scope: "archive",
      send: async (name, text) => {
        calls.push([name, text])
      },
      notify: () => {},
    })
    assert.equal(ok, true)
    assert.deepEqual(calls, [["openspec-archive-change", "done"]])
  })
})
