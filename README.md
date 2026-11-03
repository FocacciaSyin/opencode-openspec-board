# opencode-openspec-board

OpenCode TUI／Desktop 外掛：顯示 OpenSpec 進度，`/opsx` 開啟任務看板並列出各 change 的所有 tasks 與完成狀態，能直接接續 apply、update 或 archive。

## 需求

- OpenCode v2.2.x（開發 SDK 固定為 `@opencode/plugin` 2.2.0；GUI API 仍為 experimental）
- OpenSpec CLI 在 PATH 中（外掛會執行 `openspec context --json` 解析專案 root）
- 專案內有 `openspec/` 目錄

沒有 `openspec/` 的專案不顯示進度標示，也不會主動出現錯誤訊息；GUI 手動開啟看板仍可查看狀態。

## 安裝

```sh
opencode2 plugin add github:FocacciaSyin/opencode-openspec-board
```

裝完重開 OpenCode TUI（TUI 外掛在啟動時載入），在含 `openspec/` 的專案開 session，footer 應出現 `openspec <完成>/<總數> (<change 數>)`。

TUI 開著時才執行 `openspec init` 也會自動偵測，不需要再重開；`openspec/` 或 `openspec/changes/` 較晚出現都一樣。

固定版本或指定 commit：

```sh
opencode2 plugin add 'github:FocacciaSyin/opencode-openspec-board#<版本>'
opencode2 plugin add 'github:FocacciaSyin/opencode-openspec-board#<完整 commit SHA>'
```

更新：

```sh
opencode2 plugin update
```

> 如果之前手動把外掛放在 `~/.config/opencode/plugins/openspec-board/`，請先刪除該目錄，否則會同時被 discovery 和套件載入。

Desktop 會讀取全域 `~/.config/opencode/opencode.json(c)` 的 `plugins`，不讀取 TUI 專用的 `cli.json`。若只在 `cli.json` 啟用此外掛，須另在全域 server 設定加入套件或本機路徑：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["D:/Github/opencode-openspec-board"]
}
```

安裝套件同時提供 server、TUI 與 GUI，不需要另外安裝 GUI。Git 安裝使用已提交的 `build/gui.cjs`；npm 打包前會自動建置，安裝者不需要 Vite。

## TUI 使用

| 操作 | 行為 |
| --- | --- |
| `/opsx` | 開啟任務面板；尚未偵測到 OpenSpec 或解析失敗時會先重新偵測一次 |
| `j` / `k` / `↑` / `↓` | 移動反白 |
| `Enter` | 展開／收合選中 change 的 tasks；三項以內不需展開 |
| `r` | 重新偵測 OpenSpec root、重讀 tasks 並重建檔案監看 |
| `v` | 顯示下一個任務的完整內文 |
| `n` | 只做下一個：以 `openspec-apply-change` skill 送出 `<change> 只做 <task-id>` |
| `u` | 更新這張 change 的規劃：以 `openspec-update-change` skill 送出 `<change>`（先確認） |
| `a` | 整張做完：以 `openspec-apply-change` skill 送出 `<change>`（先確認） |
| `x` | 封存已完成的 change：以 `openspec-archive-change` skill 送出 `<change>`（先確認） |
| `q` / `Esc` | 關閉面板 |

footer 與面板共用 `openspec/changes/*/tasks.md` 的讀取結果，檔案變更後會自動更新，不需要重開。點擊 footer 也能開啟面板。

### `/opsx` Tasks 清單

- 直接輸入 `/opsx`，在既有右側看板查看 `OpenSpec Tasks`，不需要另找設定或開啟 OpenCode 原生側邊欄。
- 面板顯示所有未封存 change 的總完成數／總任務數，各 change 也有自己的進度。
- tasks 依 `tasks.md` 原始順序呈現，包含已完成 `[x]` 與未完成 `[ ]`，不只列出待辦。
- 每張 change 預設顯示前三個 tasks；點擊「展開其餘 N 項」看所有任務，點擊「收合」回到前三項，各張清單獨立控制。
- 鍵盤操作使用 `j/k` 或方向鍵選中 change，再按 `Enter` 展開／收合。此按鍵只在面板取得焦點時生效，不會送出對話。
- 長標題直接換行，續行對齊標題，不截斷全文；預覽上限是三個任務，不是三行。長清單在面板內捲動。
- 任務完成時只更新標記與進度，不從清單移除；完成的 change 在封存前仍可展開閱讀。零任務顯示「尚無任務」，不視為已完成。
- 這是唯讀顯示：點擊核取標記不會勾選任務，不寫回 `tasks.md`、不送出執行請求，也不額外儲存任務檔案或資料庫。
- 展開狀態只放在記憶體；同專案存檔後保留，切換專案或重新開啟 TUI 後預設收合，重開時重新讀取檔案現況。
- 沒有 OpenSpec、沒有進行中的 change 或 root 解析失敗時，`/opsx` 顯示對應提示；已開啟面板的資料若變更，會清除舊任務並更新狀態。窄終端由宿主將面板切換為全螢幕呈現。

root 偵測會執行 `openspec context --json`，冷啟動可能需要數秒，最多等待 30 秒。已有 `openspec/` 但 CLI 執行失敗或輸出無效時，會顯示偵測失敗，不會誤報成「沒有 OpenSpec」；確認 CLI 可在同一目錄正常執行後，可用 `/opsx` 重新偵測，不必重啟背景 server。

### 看板底部操作提示

`/opsx` 的快捷鍵提示固定在看板底部，不隨任務清單捲動；窄面板時提示會換行，不裁掉按鍵。上方清單超過可用高度時可捲動；使用 `j/k` 或方向鍵選取時，目前 change 的標題會保持可見。原有按鍵功能不變。

## Desktop GUI 使用

- `/opsx`、命令面板的「OpenSpec 任務看板」、側欄 **+** 選單，或輸入框上方的進度 pill 都能開啟看板。
- 每張 change 顯示完成數及前 3 項任務；可展開／收合其餘任務。「查看下一項」顯示完整內文。
- 「只做下一項」、「更新規劃」、「全部執行」、「封存」分別送出與 TUI 相同的 skill／參數；後三者先確認。封存只允許有任務且全部完成的 change。
- 執行中、有待處理訊息或正在送出時不允許操作。確認及送出準備後會重新檢查 session 與 change，並在送出前重讀資料。
- server 依目前 session 的 location 讀取及監看檔案；不同專案與 workspace 的通知不混用。變更、稍後初始化 OpenSpec 或修復 store 設定後會自動更新。
- GUI 的 CLI root 解析最多等待 15 秒，以容許 server 啟動時的磁碟競爭；TUI 最多等待 30 秒。
- 「重新整理」會重新解析 root；讀取失敗時保留錯誤提示，送出失敗時顯示可手動接續的 skill 與參數。
- 窄畫面提供宿主選單入口；面板使用宿主的關閉按鈕。沒有加入 TUI 那組單鍵快捷鍵。

## 停用

TUI：設定環境變數 `OPENCODE_OPENSPEC_BOARD_DISABLED=1` 後重開 TUI，或沿用本機 `DISABLED` 檔機制。

GUI：使用 Desktop 的 **Settings > Extensions > Plugins** 開關停用 GUI，不影響 TUI。移除整個外掛則執行 `opencode2 plugin remove opencode-openspec-board`。

## 開發

開發與 npm 安裝使用 Node.js 26.4+（符合 OpenTUI 0.7 的引擎需求）。Solid 保持 OpenTUI 要求的 1.9.12；開發依賴以 override 固定已修補的 Seroval 1.6.11。GUI 執行時使用 Desktop 提供的共享模組，仍應保持 Desktop 本身為已修補版本。

```sh
npm install
npm test          # 資料層、GUI 操作防護與 RPC 的測試
npm run typecheck # 型別檢查
npm run build     # 產生 build/gui.cjs
npm pack          # 建置並產出可安裝套件
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

改完原始碼重開 TUI 即生效。GUI 使用 `npm run build -- --watch`；本機 bundle 更新會由 Desktop 重新載入。正式建置只寫入 `build/gui.cjs`，不讀取或覆寫 `dist/gui-experimental.cjs` 實驗檔。

### 安裝驗收

1. 在乾淨目錄安裝 `npm pack` 產生的套件，確認 server、TUI、GUI 三個 export 均存在，且沒有夾帶實驗檔。
2. 以隔離的 OpenCode v2.2.x server 載入安裝後套件，呼叫 `openspec-board.read`，確認完整任務與進度；變更檔案後確認 `changed` 事件及更新結果。
3. 在 Desktop 啟用相同套件，驗證開啟入口、展開／收合、全文、四個執行動作、取消、忙碌、切換 session、斷線恢復及窄畫面。
4. 在 TUI 驗證原有 footer、快捷鍵、自動偵測與停用方式。

自動化資料／操作測試與套件安裝驗證不能取代 Desktop／TUI 的實際互動驗收；未執行者須另外列為缺口。

## 原理

- `openspec context --json` 取得真正的 OpenSpec root（支援 store 設定的專案）。
- `openspec/changes/*/tasks.md` 解析成每個 change 的所有 tasks、完成數與下一個未完成任務。
- 目錄切換時重建 watcher，`tasks.md` 或 `openspec/config.yaml` 變動會 debounce 150ms 後重讀。
- apply／update／archive 透過 `session.prompt` 指定 skill；送不出去時把 skill 與參數顯示在 toast，讓使用者手動貼上。
- GUI 透過 server RPC `openspec-board.read` 讀取完整任務，並訂閱 location 範圍的 `changed` 事件；不在 GUI 直接存取檔案或另建 Electron IPC。
