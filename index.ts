import { Plugin } from "@opencode/plugin"

/** 這個外掛只有 TUI 功能；保留空的 server 入口，讓套件能被自動載入。 */
export default Plugin.define({
  id: "openspec-board.server",
  setup() {},
})
