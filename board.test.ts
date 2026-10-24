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
  resolveRoot,
  scopedArgs,
  stepIndex,
  watchBoard,
  type Change,
} from "./board.ts"

function change(name: string, total: number, done = 0): Change {
  const tasks = Array.from({ length: total }, (_, index) => ({
    id: `1.${index + 1}`,
    title: `task ${index + 1}`,
    done: index < done,
  }))
  return { name, total, done, next: tasks.find((task) => !task.done), mtime: 0 }
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

    const beta = state.changes.find((item) => item.name === "beta")
    assert.equal(emptyLabel(beta!), "已完成，可 /opsx-archive")

    const draft = state.changes.find((item) => item.name === "draft")
    assert.equal(emptyLabel(draft!), "尚無任務，跑 /opsx-propose")
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

  test("invalid json stays hidden", () => {
    assert.equal(parseContext(project("broken-json", true), "not json"), null)
  })
})

describe("resolveRoot", () => {
  test("runner failure stays hidden", async () => {
    assert.equal(
      await resolveRoot(process.cwd(), async () => {
        throw new Error("missing")
      }),
      null,
    )
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
