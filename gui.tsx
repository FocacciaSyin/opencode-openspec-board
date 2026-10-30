/** @jsxImportSource solid-js */
import { Command, ComposerPill, MenuItem, Panel, Plugin, Style, createKeyed } from "@opencode/plugin/gui"
import { For, Show, createSignal, onCleanup } from "solid-js"
import { formatFooter, type BoardState, type Change, type DispatchOptions } from "./board.ts"
import { runGuiAction } from "./gui-actions.ts"
import { BoardRpc } from "./rpc.ts"

export default Plugin.define({
  setup(context) {
    const ui = context.ui
    const [state, setState] = createSignal<BoardState>({ kind: "no-openspec" })
    const [sessionKey, setSessionKey] = createSignal("")
    const [loading, setLoading] = createSignal(false)
    const [sending, setSending] = createSignal(false)
    const [expanded, setExpanded] = createSignal(new Set<string>())
    let refresh = async (_force = false): Promise<void> => {}
    const open = () => {
      const session = context.sessions.current()
      if (session) context.layout.open(`${context.id}:board`, session)
    }

    createKeyed(() => {
      const session = context.sessions.current()
      if (session?.location) return {
        key: session.key,
        client: session.server.client,
        location: session.location,
        connected: session.server.connected,
      }
    }, (target) => {
      setSessionKey(target.key)
      setState({ kind: "no-openspec" })
      setExpanded(new Set<string>())
      const controller = new AbortController()
      let request = 0
      const read = async (force = false) => {
        const sequence = ++request
        setLoading(true)
        try {
          const next = await target.client.rpc(BoardRpc).read({ refresh: force }, {
            location: target.location,
            signal: controller.signal,
          }) as BoardState
          if (controller.signal.aborted || sequence !== request) return
          setState(next)
          const names = new Set(next.kind === "ready" ? next.changes.map((item) => item.name) : [])
          setExpanded((previous) => new Set([...previous].filter((name) => names.has(name))))
        } catch {
          if (controller.signal.aborted || sequence !== request) return
          setState({ kind: "unresolved", message: "無法讀取 OpenSpec 看板；請確認目前 server 已載入此外掛，再按重新整理。" })
          setExpanded(new Set<string>())
        } finally {
          if (!controller.signal.aborted && sequence === request) setLoading(false)
        }
      }
      refresh = read
      const unsubscribe = target.client.rpc(BoardRpc).events.on("changed", (event) => {
        // SDK 的公開 location 只有 directory；workspace 由本外掛的事件資料補足。
        if (event.location.directory === target.location.directory && (event.data as { workspaceID?: string }).workspaceID === target.location.workspaceID) {
          void read()
        }
      })
      void read()
      onCleanup(() => {
        controller.abort()
        unsubscribe()
        if (refresh === read) refresh = async () => {}
      })
    }, {
      equals: (left, right) => left.key === right.key && left.client === right.client && left.connected === right.connected &&
        left.location.directory === right.location.directory && left.location.workspaceID === right.location.workspaceID,
      otherwise: () => {
        setSessionKey("")
        setState({ kind: "no-openspec" })
        setExpanded(new Set<string>())
        setLoading(false)
      },
    })

    context.add(Command, { id: "open", title: "OpenSpec 任務看板", group: "OpenSpec", slash: { name: "opsx" }, run: open })
    context.add(MenuItem, { menu: "session.panel", id: "board", title: "OpenSpec 任務看板", icon: "file-tree", run: open })
    context.add(ComposerPill, {
      id: "progress",
      show: ({ session }) => {
        if (session.key !== sessionKey()) return
        const label = loading() ? "OpenSpec 偵測中…" : formatFooter(state())
        return label ? { label, title: "開啟 OpenSpec 任務看板", run: open } : undefined
      },
    })

    const tab = { id: "board", title: "OpenSpec Tasks", closable: "compact" as const }
    context.add(Panel, {
      id: "board",
      region: "side",
      mobile: { title: "OpenSpec Tasks", order: 45, kind: "menu", icon: "file-tree" },
      list: ({ open }) => open.includes("board") ? [tab] : [],
      render: (props) => {
        const changes = () => {
          const current = state()
          return props.session.key === sessionKey() && current.kind === "ready" ? current.changes : []
        }
        const message = () => {
          const current = state()
          return current.kind === "unresolved" ? current.message
            : current.kind === "no-changes" ? "目前沒有進行中的 change"
              : current.kind === "no-openspec" ? "這個專案沒有 OpenSpec" : ""
        }
        const busy = () => sending() || loading() || props.session.key !== sessionKey() || props.session.pending ||
          props.session.server.data.session.status(props.session.id) !== "idle" ||
          props.session.server.data.session.pending.list(props.session.id).length > 0
        const act = async (change: Change, scope: DispatchOptions["scope"]) => {
          if (busy()) return
          const session = props.session
          const read = refresh
          setSending(true)
          try {
            await runGuiAction(context, session,
              () => !loading() && session.key === sessionKey() ? changes().find((item) => item.name === change.name) : undefined,
              scope, read)
          } finally {
            setSending(false)
          }
        }
        const toggle = (name: string) => setExpanded((previous) => {
          const next = new Set(previous)
          if (next.has(name)) next.delete(name)
          else next.add(name)
          return next
        })

        return (
          <section class="opsx-board" aria-label="OpenSpec 任務看板">
            <header class="opsx-row">
              <h2>OpenSpec Tasks</h2>
              <ui.Button size="small" variant="ghost" busy={loading()} onClick={() => void refresh(true)}>重新整理</ui.Button>
            </header>
            <Show when={state().kind === "ready"}><p>{formatFooter(state())}</p></Show>
            <Show when={!loading()} fallback={<ui.Loader />}>
              <div class="opsx-list">
                <Show when={message()}><p role="status">{message()}</p></Show>
                <For each={changes()}>{(change) => (
                  <article class="opsx-change" aria-label={change.name}>
                    <div class="opsx-row"><h3>{change.name}</h3><span>{change.done}/{change.total}</span></div>
                    <Show when={change.total === 0}><p>尚無任務</p></Show>
                    <ul class="opsx-tasks">
                      <For each={expanded().has(change.name) ? change.tasks : change.tasks.slice(0, 3)}>{(task) => (
                        <li><span aria-label={task.done ? "已完成" : "未完成"}>{task.done ? "☑" : "☐"}</span><span>{task.id} {task.title}</span></li>
                      )}</For>
                    </ul>
                    <Show when={change.total > 3}>
                      <ui.Button size="small" variant="ghost" onClick={() => toggle(change.name)}>
                        {expanded().has(change.name) ? "收合" : `展開其餘 ${change.total - 3} 項`}
                      </ui.Button>
                    </Show>
                    <div class="opsx-actions">
                      <ui.Button size="small" variant="ghost" disabled={!change.next} onClick={() => void context.dialogs.alert({
                        title: `${change.name} · ${change.next?.id}`, description: change.next?.title,
                      })}>查看下一項</ui.Button>
                      <ui.Button size="small" disabled={busy() || !change.next} onClick={() => void act(change, "next")}>只做下一項</ui.Button>
                      <ui.Button size="small" disabled={busy()} onClick={() => void act(change, "update")}>更新規劃</ui.Button>
                      <ui.Button size="small" disabled={busy() || !change.next} onClick={() => void act(change, "all")}>全部執行</ui.Button>
                      <ui.Button size="small" disabled={busy() || change.total === 0 || change.done !== change.total} onClick={() => void act(change, "archive")}>封存</ui.Button>
                    </div>
                  </article>
                )}</For>
              </div>
            </Show>
          </section>
        )
      },
    })
    context.add(Style, `
      .opsx-board{height:100%;min-height:0;display:flex;flex-direction:column;gap:12px;padding:16px;color:inherit;font:inherit}
      .opsx-board h2,.opsx-board h3,.opsx-board p{margin:0;font-size:inherit}.opsx-board h2,.opsx-board h3{font-weight:600}
      .opsx-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.opsx-row h3{min-width:0;overflow-wrap:anywhere}.opsx-row>span{white-space:nowrap}
      .opsx-list{overflow:auto;min-height:0;flex:1}.opsx-change{padding:12px 0;border-bottom:1px solid color-mix(in srgb,currentColor 18%,transparent)}
      .opsx-tasks{list-style:none;padding:0;margin:12px 0}.opsx-tasks li{display:flex;gap:8px;margin:8px 0}.opsx-tasks li>span:last-child{min-width:0;overflow-wrap:anywhere;white-space:pre-wrap}
      .opsx-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
    `)
  },
})
