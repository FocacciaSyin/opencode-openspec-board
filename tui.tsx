/** @jsxImportSource @opentui/solid */
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import type { ScrollBoxRenderable } from "@opentui/core"
import { For, Show, createEffect, createSignal } from "solid-js"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  createRootResolver,
  dispatchAction,
  emptyLabel,
  formatFooter,
  loadBoard,
  previewTasks,
  startsTaskGroup,
  retainExpanded,
  watchBoard,
  watchConfig,
  stepIndex,
  type BoardState,
  type Change,
} from "./board.ts"

const PLUGIN_ID = "openspec-board"
const PANEL_NAME = "openspec.board"
const SLASH_NAME = "opsx"

function disabled(): boolean {
  if (process.env.OPENCODE_OPENSPEC_BOARD_DISABLED === "1") return true
  try {
    return existsSync(join(dirname(fileURLToPath(import.meta.url)), "DISABLED"))
  } catch {
    return false
  }
}

/** 路徑比較用；Windows 大小寫不敏感，避免 session 目錄格式不同造成反覆切換。 */
function sameDir(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const fixed = resolve(value).replace(/\\/g, "/")
    return process.platform === "win32" ? fixed.toLowerCase() : fixed
  }
  return normalize(left) === normalize(right)
}

/** 依終端寬度截斷，避免長標題換行把版面撐開。 */
function fit(value: string, width: number): string {
  if (width <= 1) return ""
  return value.length <= width ? value : value.slice(0, width - 1) + "…"
}

function Footer(props: { text: () => string | undefined; onOpen: () => void }) {
  const context = usePlugin()
  const [hover, setHover] = createSignal(false)
  const subdued = () => context.theme.text.muted
  const accent = () => context.theme.text.base

  return (
    <Show when={props.text()}>
      {(line) => (
        <text
          fg={hover() ? accent() : subdued()}
          onMouseOver={() => setHover(true)}
          onMouseOut={() => setHover(false)}
          onMouseDown={props.onOpen}
        >
          {line()}
        </text>
      )}
    </Show>
  )
}

function Board(props: {
  panel: PanelInput
  state: () => BoardState
  follow: (sessionID?: string) => void
  expanded: () => ReadonlySet<string>
  toggle: (name: string) => void
}) {
  const context = usePlugin()
  const [index, setIndex] = createSignal(0)
  let list: ScrollBoxRenderable | undefined

  createEffect(() => props.follow(props.panel.sessionID))
  // 面板沒拿到焦點時 j/k 會被打字區吃掉，開面板就先搶回來
  props.panel.focus()

  const changes = (): Change[] => {
    const current = props.state()
    return current.kind === "ready" ? current.changes : []
  }
  const selectedIndex = () => Math.min(index(), Math.max(0, changes().length - 1))
  const selected = () => changes()[selectedIndex()]
  let revealPending = false
  const revealAfterLayout = () => {
    if (!revealPending) return
    revealPending = false
    const current = selected()
    if (current && list && !list.isDestroyed) list.scrollChildIntoView(`openspec-header-${current.name}`)
  }
  const revealSelected = () => {
    const current = selected()
    if (!current || revealPending) return
    // 繪製前已有本次排版座標，不依賴可能略過的 frame 完成事件。
    revealPending = true
    context.renderer.requestRender()
  }
  createEffect(() => { props.expanded(); revealSelected() })
  const width = () => Math.max(24, props.panel.width - 4)
  const line = (text: string, fg?: string) => <text fg={fg} wrapMode="none" truncate>{fit(text, width())}</text>
  const totals = () => {
    const current = props.state()
    return current.kind === "ready" ? `${current.done}/${current.total}` : ""
  }
  const message = () => {
    const current = props.state()
    return current.kind === "unresolved" ? current.message
      : current.kind === "no-changes" ? "目前沒有進行中的 change"
      : current.kind === "no-openspec" ? "尚無可顯示的 OpenSpec 任務" : undefined
  }
  const headerLine = (item: Change, active: boolean) => {
    const progress = `${item.done}/${item.total}`
    const name = fit(item.name, Math.max(6, width() - 2 - progress.length - 2))
    const pad = Math.max(1, width() - 2 - name.length - progress.length)
    return `${active ? "> " : "  "}${name}${" ".repeat(pad)}${progress}`
  }
  const toast = (message: string, variant: "success" | "warning" | "info") =>
    context.ui.toast.show({ message, variant, duration: 4000 })

  const running = () => {
    try {
      return context.data.session.status(props.panel.sessionID) !== "idle"
    } catch {
      return true
    }
  }

  const send = async (scope: "next" | "all" | "archive" | "update", current: Change) => {
    const sent = await dispatchAction({
      change: current,
      scope,
      send: (skill, text) =>
        context.client.session
          .prompt({
            sessionID: props.panel.sessionID,
            text,
            skills: [{ id: skill } as never],
          })
          .then(() => undefined),
      notify: (message, variant) => toast(message, variant),
    })

    if (sent && props.panel.presentation === "fullscreen") props.panel.close()
  }

  const apply = async (scope: "next" | "all") => {
    const current = selected()
    if (!current) return
    if (running()) {
      toast("執行中，請稍候", "warning")
      return
    }

    if (scope === "all") {
      const confirmed = await context.ui.dialog.confirm({
        title: "整張做完？",
        message: `${current.name}：${current.total} 個任務全部執行？`,
        label: { confirm: "開始", cancel: "取消" },
      })
      if (!confirmed) {
        props.panel.focus()
        return
      }
    }

    await send(scope, current)
  }

  /** v：顯示目前 change 下一個任務的完整內文。 */
  const detail = async () => {
    const current = selected()
    if (!current) return
    if (!current.next) {
      toast(emptyLabel(current) ?? "沒有未完成任務", "info")
      return
    }
    await context.ui.dialog.alert({ title: `${current.name} · ${current.next.id}`, message: current.next.title })
    props.panel.focus()
  }

  /** u：把這張 change 送進 update-change 流程改規劃。 */
  const update = async () => {
    const current = selected()
    if (!current) return
    if (running()) {
      toast("執行中，請稍候", "warning")
      return
    }

    const confirmed = await context.ui.dialog.confirm({
      title: "更新這張 change？",
      message: `${current.name}：重新調整 proposal／specs／design／tasks？`,
      label: { confirm: "更新", cancel: "取消" },
    })
    if (!confirmed) {
      props.panel.focus()
      return
    }

    await send("update", current)
  }

  const archive = async () => {
    const current = selected()
    if (!current) return
    if (running()) {
      toast("執行中，請稍候", "warning")
      return
    }
    if (current.total === 0 || current.done !== current.total) {
      toast(`還有 ${current.total - current.done} 個任務未完成`, "warning")
      return
    }

    const confirmed = await context.ui.dialog.confirm({
      title: "封存 change？",
      message: `${current.name}：移到 archive 並更新主 spec？`,
      label: { confirm: "封存", cancel: "取消" },
    })
    if (!confirmed) return

    await send("archive", current)
  }

  context.keymap.layer(() => ({
    mode: "base",
    priority: 20,
    commands: [
      {
        id: "openspec-board.up",
        bind: "k,up",
        enabled: () => changes().length > 0,
        run: () => {
          setIndex(stepIndex(selectedIndex(), -1, changes().length))
        },
      },
      {
        id: "openspec-board.down",
        bind: "j,down",
        enabled: () => changes().length > 0,
        run: () => {
          setIndex(stepIndex(selectedIndex(), 1, changes().length))
        },
      },
      {
        id: "openspec-board.toggle-tasks",
        bind: "return",
        enabled: () => (selected()?.total ?? 0) > 3,
        run: () => { const current = selected(); if (current) props.toggle(current.name) },
      },
      { id: "openspec-board.next-task", bind: "n", run: () => void apply("next") },
      { id: "openspec-board.detail", bind: "v", run: () => void detail() },
      {
        id: "openspec-board.update",
        bind: "u",
        run: () => void update(),
      },
      { id: "openspec-board.all-tasks", bind: "a", run: () => void apply("all") },
      { id: "openspec-board.archive", bind: "x", run: () => void archive() },
      { id: "openspec-board.close", bind: "q,escape", run: () => props.panel.close() },
    ],
    bindings: [
      "openspec-board.up",
      "openspec-board.down",
      "openspec-board.toggle-tasks",
      "openspec-board.next-task",
      "openspec-board.detail",
      "openspec-board.update",
      "openspec-board.all-tasks",
      "openspec-board.archive",
      "openspec-board.close",
    ],
  }))

  return (
    <box flexDirection="column" width="100%" height="100%" minHeight={0}>
      <box flexDirection="column" flexShrink={0}>
        {line(`OpenSpec Tasks   ${changes().length} active · ${totals()}`)}
        {line("─".repeat(width()), "#5a5f7a")}
      </box>
      {/* shortcut: 停用離屏裁切以更新標題座標；大量任務造成延遲時改用離屏排版座標定位。 */}
      <scrollbox
        ref={(value) => { list = value }}
        flexGrow={1} flexShrink={1} minHeight={0} scrollX={false}
        viewportCulling={false}
        contentOptions={{ flexDirection: "column" }}
        onSizeChange={revealSelected}
        renderBefore={revealAfterLayout}
      >
        <Show when={message()}>{(text) => <text fg={context.theme.text.muted} wrapMode="word">{text()}</text>}</Show>
        <For each={changes()}>
          {(item, position) => (
            <box id={`openspec-change-${item.name}`} flexDirection="column" flexShrink={0} width="100%">
              <box id={`openspec-header-${item.name}`} height={1} flexShrink={0} onMouseDown={() => { setIndex(position()); props.panel.focus() }}>
                {line(headerLine(item, position() === selectedIndex()), position() === selectedIndex() ? "#7aa2f7" : undefined)}
              </box>
              <Show when={item.total === 0}>
                <text fg={context.theme.text.muted}>  尚無任務</text>
              </Show>
              <Show when={item.total > 0 && item.done === item.total}>
                <text fg={context.theme.text.muted}>  已完成</text>
              </Show>
              <For each={previewTasks(item, props.expanded().has(item.name))}>
                {(task, taskIndex) => (
                  <>
                    {/* 大項之間以縮排的細虛線分隔，與 change 之間的實線區隔層級。 */}
                    <Show when={startsTaskGroup(item.tasks, taskIndex())}>
                      {line(`  ${"┈".repeat(Math.max(0, width() - 2))}`, "#3b3f54")}
                    </Show>
                    <box flexDirection="row" alignItems="flex-start" flexShrink={0} width="100%">
                      <text fg={context.theme.text.muted} flexShrink={0}>  {task.done ? "[x]" : "[ ]"} {task.id} </text>
                      <text
                        fg={task.done ? context.theme.text.muted : context.theme.text.base}
                        flexGrow={1} flexShrink={1} minWidth={0} wrapMode="word"
                      >{task.title}</text>
                    </box>
                  </>
                )}
              </For>
              <Show when={item.total > 3}>
                <text fg={context.theme.text.base} onMouseDown={() => {
                  setIndex(position())
                  props.panel.focus()
                  props.toggle(item.name)
                }}>
                  {props.expanded().has(item.name) ? "  收合" : `  展開其餘 ${item.total - 3} 項`}
                </text>
              </Show>
              {position() < changes().length - 1 ? line(" ") : null}
            </box>
          )}
        </For>
      </scrollbox>
      <box flexDirection="column" flexShrink={0}>
        {line("─".repeat(width()), "#5a5f7a")}
        <text fg={context.theme.text.muted} wrapMode="word">   v 全文   n 下一個   u 更新   a 整張   x 封存</text>
        <text fg={context.theme.text.muted} wrapMode="word">   Enter 展開/收合   j/k ↑↓ 移動   q/Esc 關閉</text>
      </box>
    </box>
  )
}

export default disabled()
  ? { id: PLUGIN_ID, setup() {} }
  : Plugin.define({
      id: PLUGIN_ID,
      setup(context) {
        const baseDir = context.location?.directory ?? process.cwd()
        const [dir, setDir] = createSignal(baseDir)
        const [state, setState] = createSignal<BoardState>({ kind: "no-openspec" })
        const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
        const resolver = createRootResolver()

        const updateState = (next: BoardState) => {
          setState(next)
          setExpanded((previous) => retainExpanded(previous, next))
        }

        const toggleTasks = (name: string) => {
          const current = state()
          if (current.kind !== "ready" || !current.changes.some((item) => item.name === name && item.total > 3)) return
          setExpanded((previous) => {
            const next = new Set(previous)
            if (next.has(name)) next.delete(name)
            else next.add(name)
            return next
          })
        }

        let stopChanges: (() => void) | undefined
        let stopConfig: (() => void) | undefined

        const stopWatching = () => {
          stopChanges?.()
          stopChanges = undefined
        }

        /** 解析 root 後才讀 changes 並建立 watcher；undefined 代表已被較新的切換取代。 */
        const boot = async (target: string) => {
          const root = await resolver.resolve(target)
          if (root === undefined || !sameDir(target, dir())) return

          if (root === null) {
            stopWatching()
            updateState({ kind: "no-openspec" })
            return
          }
          if ("unresolved" in root) {
            stopWatching()
            updateState({ kind: "unresolved", message: root.unresolved })
            return
          }

          updateState(loadBoard(root.path))
          stopWatching()
          stopChanges = watchBoard(root.path, () => {
            if (sameDir(target, dir())) updateState(loadBoard(root.path))
          })
        }

        const watchDir = (target: string) => {
          stopConfig?.()
          stopConfig = watchConfig(target, () => {
            resolver.forget(target)
            void boot(target)
          })
        }

        const switchDir = (next: string) => {
          if (!next || sameDir(next, dir())) return
          stopWatching()
          updateState({ kind: "no-openspec" })
          setDir(next)
          watchDir(next)
          void boot(next)
        }

        watchDir(baseDir)
        void boot(baseDir)

        const sessionDir = (sessionID?: string) => {
          if (!sessionID) return undefined
          try {
            return context.data.session.get(sessionID)?.location?.directory
          } catch {
            return undefined
          }
        }

        const follow = (sessionID?: string) => {
          const route = context.ui.router.current()
          if (sessionID && (route.type !== "session" || route.sessionID !== sessionID)) return
          const next = sessionDir(sessionID) ?? baseDir
          if (!sameDir(next, dir())) queueMicrotask(() => switchDir(next))
        }

        /** 首頁沒有 sessionID，改跟隨預設 location；它也是 Solid signal，換專案會重算。 */
        const followLocation = () => {
          let next: string | undefined
          try {
            next = context.data.location.default()?.directory
          } catch {
            next = undefined
          }
          if (next && !sameDir(next, dir())) queueMicrotask(() => switchDir(next))
        }

        const sessionState = (sessionID: string): BoardState => {
          const route = context.ui.router.current()
          return route.type === "session" && route.sessionID === sessionID
            && sameDir(sessionDir(sessionID) ?? baseDir, dir()) ? state() : { kind: "no-openspec" }
        }

        const openBoard = async () => {
          let current = state()
          // 專案可能是外掛啟動後才初始化，或 store 後來才修好；先重問一次再判斷。
          if (current.kind === "no-openspec" || current.kind === "unresolved") {
            resolver.forget(dir())
            await boot(dir())
            current = state()
          }
          if (current.kind === "no-openspec") {
            context.ui.toast.show({ message: "這個專案沒有 OpenSpec", variant: "info" })
            return
          }
          if (current.kind === "unresolved") {
            context.ui.toast.show({ message: current.message, variant: "warning" })
            return
          }
          if (current.kind !== "ready") {
            context.ui.toast.show({ message: "目前沒有進行中的 change", variant: "info" })
            return
          }
          if (!context.ui.panel.open(PANEL_NAME)) {
            context.ui.toast.show({ message: "請先進入一個 session", variant: "warning" })
          }
        }

        context.ui.slot({
          append: "prompt.footer.status",
          render: (input) => {
            createEffect(() => follow(input.sessionID))
            return <Footer text={() => formatFooter(input.sessionID ? sessionState(input.sessionID) : state())} onOpen={openBoard} />
          },
        })

        context.ui.slot({
          append: "home.footer.status",
          render: () => {
            followLocation()
            return <Footer text={() => formatFooter(state())} onOpen={openBoard} />
          },
        })

        context.ui.slot({
          append: "session.panel",
          render: (panel) => (
            <Show when={panel.name === PANEL_NAME}>
              <Board panel={panel} state={() => sessionState(panel.sessionID)} follow={follow} expanded={expanded} toggle={toggleTasks} />
            </Show>
          ),
        })

        context.ui.slot({
          append: "app",
          render: () => {
            context.keymap.layer(() => ({
              mode: "global",
              priority: 10,
              commands: [
                {
                  id: "openspec-board.open",
                  title: "OpenSpec 任務看板",
                  group: "OpenSpec",
                  slash: { name: SLASH_NAME },
                  palette: true,
                  run: () => openBoard(),
                },
              ],
              bindings: ["openspec-board.open"],
            }))
            return <></>
          },
        })

        return () => {
          stopWatching()
          stopConfig?.()
        }
      },
    })
