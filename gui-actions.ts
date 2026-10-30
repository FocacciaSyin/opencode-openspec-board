import type { Context, SessionRef } from "@opencode/plugin/gui"
import { dispatchAction, type Change, type DispatchOptions } from "./board.ts"

/** 確認與非同步準備之後重檢 session、skill 與最新 change，避免送到已切換的工作。 */
export async function runGuiAction(
  context: Pick<Context, "sessions" | "toast" | "dialogs">,
  session: SessionRef,
  current: () => Change | undefined,
  scope: DispatchOptions["scope"],
  refresh: () => Promise<void>,
): Promise<boolean> {
  const key = session.key
  const id = session.id
  const data = session.server.data
  const client = session.server.client
  const location = session.location
  const available = () => {
    try {
      return !!location && context.sessions.current()?.key === key && !session.pending &&
        session.location?.directory === location.directory && session.location?.workspaceID === location.workspaceID &&
        session.server.data === data && session.server.client === client &&
        data.session.status(id) === "idle" && data.session.pending.list(id).length === 0
    } catch {
      return false
    }
  }
  const notify = (title: string, variant: "success" | "warning") => {
    context.toast.show({ title, variant: variant === "warning" ? "default" : "success" })
  }
  if (!available()) {
    notify("請切回原 session 並等待目前工作完成", "warning")
    return false
  }
  const change = current()
  if (!change) {
    notify("這張 change 已不存在，請重新整理", "warning")
    return false
  }
  const unchanged = (next: Change | undefined) => next && next.name === change.name && next.mtime === change.mtime &&
    (scope !== "next" || next.next?.id === change.next?.id) &&
    (scope !== "archive" || (next.total > 0 && next.done === next.total))
  if (scope === "archive" && !unchanged(change)) {
    notify("只有包含任務且全部完成的 change 才能封存", "warning")
    return false
  }

  try {
    if (scope !== "next") {
      const title = scope === "all" ? "整張做完？" : scope === "archive" ? "封存 change？" : "更新這張 change？"
      const description = scope === "all" ? `${change.name}：${change.total} 個任務全部執行？`
        : scope === "archive" ? `${change.name}：移到 archive 並更新主 spec？`
          : `${change.name}：重新調整 proposal／specs／design／tasks？`
      if (!await context.dialogs.confirm({ title, description, confirm: "繼續", danger: scope === "archive" })) return false
    }
    if (!available() || !unchanged(current())) {
      notify("session 或 change 狀態已變更，未送出操作", "warning")
      return false
    }
    return await dispatchAction({
      change,
      scope,
      notify,
      send: async (skill, text) => {
        await data.location.skill.sync(location)
        if (!available() || !data.location.skill.list(location).some((item) => item.id === skill)) {
          throw new Error("目前無法使用此 skill")
        }
        // 不只依賴事件快取：確認期間 tasks.md 可能已變更但通知尚未抵達。
        await refresh()
        if (!available() || !unchanged(current())) throw new Error("session 或 change 狀態已變更")
        await client.session.prompt({ sessionID: id, text, skills: [{ id: skill }] })
      },
    })
  } catch {
    notify("無法準備操作，請重新整理後再試", "warning")
    return false
  }
}
