import { strict as assert } from "node:assert"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import plugin from "./index.ts"
import { BoardRpc } from "./rpc.ts"

// server 只註冊目前 location 的 RPC；清理須同時釋放 watcher 與 RPC registration。
test("server 註冊看板契約並在卸載時清理", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "board-rpc-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  let definition: unknown
  let disposed = false
  const context = {
    location: { directory: root },
    rpc: { register: async (contract: unknown) => {
      definition = contract
      return { events: { emit: async () => {} }, dispose: async () => { disposed = true } }
    } },
  }
  const cleanup = await plugin.setup(context as unknown as Parameters<typeof plugin.setup>[0])
  assert.equal(definition, BoardRpc)
  assert.equal(BoardRpc.id, "openspec-board")
  assert.deepEqual(Object.keys(BoardRpc.methods), ["read"])
  assert.deepEqual(Object.keys(BoardRpc.events), ["changed"])
  assert.equal(typeof cleanup, "function")
  await (cleanup as () => Promise<void>)()
  assert.equal(disposed, true)
})

// 事件的 workspace 欄位由 location 提供，避免 GUI 依缺少此欄位的公開 event.location 判斷。
test("changed 事件保留可選 workspace 欄位且拒絕額外屬性", () => {
  assert.deepEqual(BoardRpc.events.changed.schema.properties, { workspaceID: { type: "string" } })
  assert.equal(BoardRpc.events.changed.schema.additionalProperties, false)
  assert.equal(BoardRpc.methods.read.input.additionalProperties, false)
})
