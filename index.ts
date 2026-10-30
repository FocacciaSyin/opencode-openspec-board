import { Plugin } from "@opencode/plugin"
import { createBoardSource } from "./board.ts"
import { BoardRpc } from "./rpc.ts"

export default Plugin.define({
  id: "openspec-board.server",
  async setup(context) {
    const source = createBoardSource(context.location.directory, () => {
      // 卸載或斷線時事件可能無法送達；保留手動重新整理作為恢復入口。
      void registration.events.emit("changed", context.location.workspaceID ? { workspaceID: context.location.workspaceID } : {}).catch(() => {})
    })
    const registration = await context.rpc.register(BoardRpc, {
      read: async (input) => source.read((input as { refresh?: boolean }).refresh === true),
    })
    return async () => {
      source.dispose()
      await registration.dispose()
    }
  },
})
