import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { Change, DispatchOptions } from "./board.ts"
import { runGuiAction } from "./gui-actions.ts"

function fixture() {
  const tasks = [{ id: "1.1", title: "第一項", done: false }]
  let change: Change | undefined = { name: "alpha", tasks, done: 0, total: 1, next: tasks[0], mtime: 1 }
  const sent: unknown[] = []
  const notes: string[] = []
  let activeKey = "server\nsession-a"
  let status = "idle"
  let pending = 0
  let skills = ["openspec-apply-change", "openspec-update-change", "openspec-archive-change"]
  let confirm = async () => true
  let sync = async () => {}
  let refresh = async () => {}
  const data = {
    session: { status: () => status, pending: { list: () => Array(pending).fill({}) } },
    location: { skill: { sync: () => sync(), list: () => skills.map((id) => ({ id })) } },
  }
  const client = { session: { prompt: async (input: unknown) => { sent.push(input) } } }
  const session = { key: activeKey, id: "session-a", pending: false, location: { directory: "/project" }, server: { data, client } }
  const context = {
    sessions: { current: () => ({ key: activeKey }) },
    dialogs: { confirm: () => confirm() },
    toast: { show: ({ title }: { title: string }) => { notes.push(title) } },
  }
  return {
    sent, notes, session,
    run: (scope: DispatchOptions["scope"]) => runGuiAction(
      context as unknown as Parameters<typeof runGuiAction>[0],
      session as unknown as Parameters<typeof runGuiAction>[1],
      () => change, scope, () => refresh()),
    setChange: (value: Change | undefined) => { change = value },
    getChange: () => change!,
    setActive: (value: string) => { activeKey = value },
    setStatus: (value: string) => { status = value },
    setPending: (value: number) => { pending = value },
    setSkills: (value: string[]) => { skills = value },
    setConfirm: (value: () => Promise<boolean>) => { confirm = value },
    setSync: (value: () => Promise<void>) => { sync = value },
    setRefresh: (value: () => Promise<void>) => { refresh = value },
  }
}

// 四個執行動作須送出正確 skill 與參數，下一項限定 task，其餘限定 change。
for (const [scope, skill, text] of [
  ["next", "openspec-apply-change", "alpha 只做 1.1"],
  ["all", "openspec-apply-change", "alpha"],
  ["update", "openspec-update-change", "alpha"],
  ["archive", "openspec-archive-change", "alpha"],
] as const) {
  test(`${scope} 送至原 session 並攜帶指定 skill`, async () => {
    const f = fixture()
    if (scope === "archive") f.setChange({ ...f.getChange(), done: 1, next: undefined })
    assert.equal(await f.run(scope), true)
    assert.deepEqual(f.sent, [{ sessionID: "session-a", text, skills: [{ id: skill }] }])
  })
}

// 忙碌、排隊、缺少下一項或 change 消失都不得送出。
for (const scenario of ["busy", "pending", "no-next", "missing", "new-session"] as const) {
  test(`${scenario} 阻止送出下一項`, async () => {
    const f = fixture()
    if (scenario === "busy") f.setStatus("busy")
    if (scenario === "pending") f.setPending(1)
    if (scenario === "no-next") f.setChange({ ...f.getChange(), next: undefined })
    if (scenario === "missing") f.setChange(undefined)
    if (scenario === "new-session") f.session.pending = true
    assert.equal(await f.run("next"), false)
    assert.equal(f.sent.length, 0)
  })
}

// 確認取消、確認後切換 session 或變更任務，都不能繼續原操作。
for (const scenario of ["cancel", "switch", "modified", "removed"] as const) {
  test(`${scenario} 在確認後阻止整張執行`, async () => {
    const f = fixture()
    f.setConfirm(async () => {
      if (scenario === "switch") f.setActive("server\nsession-b")
      if (scenario === "modified") f.setChange({ ...f.getChange(), mtime: 2 })
      if (scenario === "removed") f.setChange(undefined)
      return scenario !== "cancel"
    })
    assert.equal(await f.run("all"), false)
    assert.equal(f.sent.length, 0)
  })
}

// 非同步 skill 同步及最後讀檔後仍須重檢，不能只信任確認前的狀態。
for (const scenario of ["missing-skill", "sync-switch", "refresh-modified", "refresh-next", "restarted", "failed-sync", "failed-refresh"] as const) {
  test(`${scenario} 在準備期間阻止送出`, async () => {
    const f = fixture()
    if (scenario === "missing-skill") f.setSkills([])
    if (scenario === "sync-switch") f.setSync(async () => { f.setActive("server\nsession-b") })
    if (scenario === "refresh-modified") f.setRefresh(async () => { f.setChange({ ...f.getChange(), mtime: 2 }) })
    if (scenario === "refresh-next") f.setRefresh(async () => { f.setChange({ ...f.getChange(), next: { id: "1.2", title: "第二項", done: false } }) })
    if (scenario === "restarted") f.setSync(async () => { f.session.server.data = { ...f.session.server.data } })
    if (scenario === "failed-sync") f.setSync(async () => { throw new Error("offline") })
    if (scenario === "failed-refresh") f.setRefresh(async () => { throw new Error("offline") })
    assert.equal(await f.run("next"), false)
    assert.equal(f.sent.length, 0)
    assert.ok(f.notes.length > 0)
  })
}

// 封存只允許有任務且全部完成，送出前重讀若撤銷完成也必須阻止。
for (const scenario of ["empty", "incomplete", "reopened"] as const) {
  test(`${scenario} 不允許封存`, async () => {
    const f = fixture()
    if (scenario === "empty") f.setChange({ ...f.getChange(), total: 0, done: 0, tasks: [], next: undefined })
    if (scenario === "reopened") {
      f.setChange({ ...f.getChange(), done: 1, next: undefined })
      f.setRefresh(async () => { f.setChange({ ...f.getChange(), done: 0 }) })
    }
    assert.equal(await f.run("archive"), false)
    assert.equal(f.sent.length, 0)
  })
}

// 送出遭拒時保留 skill 與參數供手動接續，不宣告成功。
test("prompt 失敗時顯示手動接續參數", async () => {
  const f = fixture()
  f.session.server.client.session.prompt = async () => { throw new Error("offline") }
  assert.equal(await f.run("next"), false)
  assert.deepEqual(f.notes, ["openspec-apply-change alpha 只做 1.1"])
})
