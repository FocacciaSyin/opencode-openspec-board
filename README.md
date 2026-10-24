# opencode-openspec-board

OpenCode TUI 外掛：footer 常駐顯示 OpenSpec 進度，`/opsx` 開面板看每個 change 的下一個任務，並能直接接續 apply 或 archive。

## 需求

- OpenCode v2
- OpenSpec CLI 在 PATH 中（外掛會執行 `openspec context --json` 解析專案 root）
- 專案內有 `openspec/` 目錄

沒有 `openspec/` 的專案不會顯示任何內容，也不會有錯誤訊息。

## 安裝

```sh
opencode plugin add github:FocacciaSyin/opencode-openspec-board
```

裝完重開 OpenCode TUI（TUI 外掛在啟動時載入），在含 `openspec/` 的專案開 session，footer 應出現 `openspec <完成>/<總數> (<change 數>)`。

固定版本或指定 commit：

```sh
opencode plugin add 'github:FocacciaSyin/opencode-openspec-board#v0.1.0'
opencode plugin add 'github:FocacciaSyin/opencode-openspec-board#<完整 commit SHA>'
```

更新：

```sh
opencode plugin update
```

> 如果之前手動把外掛放在 `~/.config/opencode/plugins/openspec-board/`，請先刪除該目錄，否則會同時被 discovery 和套件載入。

## 使用

| 操作 | 行為 |
| --- | --- |
| `/opsx` | 開啟任務面板 |
| `j` / `k` | 移動反白 |
| `v` | 顯示下一個任務的完整內文 |
| `n` | 只做下一個：`/opsx-apply <change> 只做 <task-id>` |
| `u` | 更新這張 change 的規劃：`/opsx-update <change>`（先確認） |
| `a` | 整張做完（先確認） |
| `x` | 封存已完成的 change（先確認） |
| `q` | 關閉面板 |

footer 與面板都直接讀 `openspec/changes/*/tasks.md`，檔案變更後會自動更新，不需要重開。點擊 footer 也能開啟面板。

## 停用

設定環境變數 `OPENCODE_OPENSPEC_BOARD_DISABLED=1` 後重開 TUI；移除外掛則執行 `opencode plugin remove opencode-openspec-board`。

## 開發

```sh
npm install
npm test          # 資料層與送出 fallback 的單元測試
npm run typecheck # 型別檢查
```

本機開發時，把 OpenCode 的 discovery 路徑連到這個 repo，就不必每次同步檔案。Windows（以系統管理員或開發人員模式開啟 PowerShell）：

```powershell
Remove-Item "$HOME\.config\opencode\plugins\openspec-board" -Recurse -Force
New-Item -ItemType Junction -Path "$HOME\.config\opencode\plugins\openspec-board" -Target "<這個 repo 的絕對路徑>"
```

macOS / Linux：

```sh
ln -s "<這個 repo 的絕對路徑>" ~/.config/opencode/plugins/openspec-board
```

改完原始碼重開 TUI 即生效。

## 原理

- `openspec context --json` 取得真正的 OpenSpec root（支援 store 設定的專案）。
- `openspec/changes/*/tasks.md` 解析成每個 change 的完成數與下一個未完成任務。
- 目錄切換時重建 watcher，`tasks.md` 或 `openspec/config.yaml` 變動會 debounce 150ms 後重讀。
- apply／archive 走 `session.command`；送不出去時把完整指令顯示在 toast，讓使用者手動貼上。
