import { strict as assert } from "node:assert"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { createBoardSource, type BoardState } from "./board.ts"

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function eventually(check: () => boolean) {
  const deadline = Date.now() + 4000
  while (!check() && Date.now() < deadline) await delay(40)
  assert.ok(check(), "檔案監看應在期限內通知")
}

function writeTasks(root: string, text = "- [ ] 1.1 第一項\n- [x] 1.2 第二項\n") {
  const dir = join(root, "openspec", "changes", "alpha")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "tasks.md"), text)
}

// 不同 location 必須各自解析與監看；讀取保留完整任務，卸載後不得再收到通知。
test("資料來源依目錄隔離並於卸載後停止通知", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "board-source-"))
  const a = join(root, "a")
  const b = join(root, "b")
  writeTasks(a)
  writeTasks(b, "- [x] 1.1 已完成\n")
  let changesA = 0
  let changesB = 0
  const runner = async (path: string) => JSON.stringify({ root: { path } })
  const sourceA = createBoardSource(a, () => changesA++, runner)
  const sourceB = createBoardSource(b, () => changesB++, runner)
  t.after(() => { sourceA.dispose(); sourceB.dispose(); rmSync(root, { recursive: true, force: true }) })

  const state = await sourceA.read()
  assert.equal(state.kind, "ready")
  if (state.kind !== "ready") return
  assert.equal(state.changes[0].tasks.length, 2)
  assert.equal(state.changes[0].next?.id, "1.1")
  assert.equal((await sourceB.read() as Extract<BoardState, { kind: "ready" }>).done, 1)
  // Windows 可能在 watcher 綁定後才送達建目錄的初始通知，先排空再比較。
  await delay(350)
  const beforeA = changesA
  const beforeB = changesB
  writeTasks(a, "- [x] 1.1 第一項\n- [x] 1.2 第二項\n")
  await eventually(() => changesA > beforeA)
  assert.equal(changesB, beforeB)
  assert.equal((await sourceA.read() as Extract<BoardState, { kind: "ready" }>).done, 2)
  sourceA.dispose()
  const before = changesA
  writeTasks(a)
  await delay(350)
  assert.equal(changesA, before)
})

// 啟動時沒有 OpenSpec，之後初始化仍須通知，不能快取否定結果。
test("稍後建立 OpenSpec 時重新解析並讀取任務", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "board-source-late-"))
  let notifications = 0
  let initialized = false
  const source = createBoardSource(root, () => notifications++, async () => JSON.stringify({ root: initialized ? { path: root } : null }))
  t.after(() => { source.dispose(); rmSync(root, { recursive: true, force: true }) })
  assert.equal((await source.read()).kind, "no-openspec")
  initialized = true
  writeTasks(root)
  await eventually(() => notifications > 0)
  assert.equal((await source.read()).kind, "ready")
})

// 已有 OpenSpec 但 changes 較晚出現時，watcher 必須接上新目錄及後續存檔。
test("稍後建立 changes 後持續監看任務", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "board-source-changes-"))
  mkdirSync(join(root, "openspec"))
  let notifications = 0
  const source = createBoardSource(root, () => notifications++, async () => JSON.stringify({ root: { path: root } }))
  t.after(() => { source.dispose(); rmSync(root, { recursive: true, force: true }) })
  assert.equal((await source.read()).kind, "no-changes")
  writeTasks(root)
  await eventually(() => notifications > 0)
  assert.equal((await source.read()).kind, "ready")
  const before = notifications
  writeTasks(root, "- [x] 1.1 完成\n")
  await eventually(() => notifications > before)
})

// config 修復或切換 store 時必須清除 root 快取，且停止舊 store 的監看。
test("設定變更會修復解析並切換到新 store", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "board-source-store-"))
  const project = join(root, "project")
  const first = join(root, "first")
  const second = join(root, "second")
  mkdirSync(join(project, "openspec"), { recursive: true })
  writeTasks(first)
  writeTasks(second, "- [x] 1.1 完成\n")
  let path: string | undefined
  let notifications = 0
  const source = createBoardSource(project, () => notifications++, async () => JSON.stringify({ root: path ? { path } : null, status: [{ message: "Unknown store" }] }))
  t.after(() => { source.dispose(); rmSync(root, { recursive: true, force: true }) })
  assert.equal((await source.read()).kind, "unresolved")
  path = first
  writeFileSync(join(project, "openspec", "config.yaml"), "store: first\n")
  await eventually(() => notifications > 0)
  assert.equal((await source.read()).kind, "ready")
  const before = notifications
  path = second
  writeFileSync(join(project, "openspec", "config.yaml"), "store: second\n")
  await eventually(() => notifications > before)
  assert.equal((await source.read() as Extract<BoardState, { kind: "ready" }>).done, 1)
  const switched = notifications
  writeTasks(first, "- [x] 1.1 舊 store\n")
  await delay(350)
  assert.equal(notifications, switched)
})

// refresh 明確要求重跑 CLI；一般讀取只重讀檔案，不反覆執行 root 解析。
test("手動重新整理清除有效 root 快取", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "board-source-refresh-"))
  writeTasks(root)
  let calls = 0
  const source = createBoardSource(root, () => {}, async () => { calls++; return JSON.stringify({ root: { path: root } }) })
  t.after(() => { source.dispose(); rmSync(root, { recursive: true, force: true }) })
  await source.read()
  await source.read()
  assert.equal(calls, 1)
  await source.read(true)
  assert.equal(calls, 2)
})

// 外掛在 CLI 解析中被卸載時，晚到的結果不得重新啟動 watcher。
test("卸載會忽略尚未完成的 root 解析", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "board-source-dispose-"))
  let finish: (value: string) => void
  let notifications = 0
  const source = createBoardSource(root, () => notifications++, () => new Promise((resolve) => { finish = resolve }))
  t.after(() => { source.dispose(); rmSync(root, { recursive: true, force: true }) })
  const pending = source.read()
  source.dispose()
  finish!(JSON.stringify({ root: { path: root } }))
  assert.equal((await pending).kind, "no-openspec")
  writeTasks(root)
  await delay(350)
  assert.equal(notifications, 0)
})

// 多視窗同時重新解析時，舊讀取須等待最新結果，不能讓操作拿到過期快取。
test("同時讀取會等待最新解析而非回傳舊狀態", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "board-source-concurrent-"))
  writeTasks(root)
  const pending: Array<(value: string) => void> = []
  const source = createBoardSource(root, () => {}, () => new Promise((resolve) => pending.push(resolve)))
  t.after(() => { source.dispose(); rmSync(root, { recursive: true, force: true }) })
  let firstFinished = false
  const first = source.read().then((value) => { firstFinished = true; return value })
  const latest = source.read(true)
  pending[0](JSON.stringify({ root: null }))
  await delay(0)
  assert.equal(firstFinished, false)
  pending[1](JSON.stringify({ root: { path: root } }))
  assert.deepEqual(await first, await latest)
  assert.equal((await latest).kind, "ready")
})
