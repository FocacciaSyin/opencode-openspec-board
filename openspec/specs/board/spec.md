# board Specification

## Purpose

讓 TUI 與 Desktop GUI 共用 OpenSpec 任務資料與既有 skill 操作；專案於外掛執行期間才被建立或修復時，仍能自行發現並顯示進度，不需要重啟。

## Requirements

### Requirement: 稍後才出現的 OpenSpec 目錄會自動被偵測

外掛執行期間，若專案的 `openspec/` 或 `openspec/changes/` 比 TUI 啟動時間晚出現，看板狀態 SHALL 在不需要重啟 TUI 的情況下更新。

#### Scenario: 啟動後才初始化 OpenSpec

- **WHEN** TUI 啟動時專案目錄沒有 `openspec/`，之後在同一個目錄執行 `openspec init`
- **THEN** footer 出現 `openspec <完成>/<總數> (<change 數>)`，不需要重開 TUI

#### Scenario: changes 目錄較晚出現

- **WHEN** 專案已有 `openspec/` 但沒有 `openspec/changes/`，之後才建立該目錄與第一個 change
- **THEN** 看板狀態由「沒有進行中的 change」變成列出該 change 與其任務進度

#### Scenario: 專案始終沒有 OpenSpec

- **WHEN** 專案目錄從頭到尾都沒有 `openspec/`
- **THEN** footer 不顯示任何內容，也不出現錯誤訊息

### Requirement: 使用者可以要求重新偵測專案

當看板狀態是「未偵測到 OpenSpec」或「解析失敗」時，執行 `/opsx` SHALL 重新解析目前專案，而不是只顯示提示。

#### Scenario: 手動重試後偵測成功

- **WHEN** 狀態為未偵測到 OpenSpec，使用者執行 `/opsx`，此時 `openspec/` 已存在
- **THEN** 系統重新解析並在成功後開啟任務看板

#### Scenario: 手動重試後仍然失敗

- **WHEN** 使用者執行 `/opsx` 而專案仍然解析不到 OpenSpec
- **THEN** 顯示提示訊息，看板狀態維持原狀

### Requirement: 同一套件提供 Desktop GUI 並保留 TUI

套件 SHALL 保留原有 TUI export、顯示與快捷鍵，並提供 `./gui-experimental` export 指向預先建置的單檔 CommonJS GUI。正式建置 SHALL 不覆寫既有 `dist/gui-experimental.cjs` 實驗檔。

#### Scenario: 安裝套件後載入 GUI

- **WHEN** 使用者在相容的 OpenCode Desktop 全域 server 設定啟用套件
- **THEN** GUI 可從 `/opsx`、命令面板、側欄選單或進度 pill 開啟任務看板，不需要安裝者自行建置

#### Scenario: TUI 操作維持不變

- **WHEN** 同一套件在 TUI 載入
- **THEN** footer、`/opsx`、`j/k`、方向鍵、`v/n/u/a/x/q/Esc` 與原有停用方式維持正常

### Requirement: GUI 顯示完整任務並依 location 更新

GUI SHALL 顯示總進度、各 change 完成數及任務完成狀態；每張預設顯示前 3 項，提供展開／收合與下一項全文。資料 SHALL 經由 server RPC 取得，事件須區分 directory 與 workspace。

#### Scenario: 任務或設定變更

- **WHEN** 任務檔變更、OpenSpec 目錄較晚建立或 store 設定修復
- **THEN** server 通知對應 location，GUI 更新任務與進度，不套用其他 location 的事件

#### Scenario: 手動恢復讀取

- **WHEN** 使用者按「重新整理」
- **THEN** server 重新解析 root 並回傳目前狀態；讀取失敗顯示提示而不宣告成功

### Requirement: GUI 操作使用既有 skill 並防止誤送

GUI SHALL 提供只做下一項、更新規劃、全部執行與封存；查看下一項僅顯示內文，不送出工作。執行動作 SHALL 使用與 TUI 相同的 skill／參數，不直接修改任務或封存檔案。

#### Scenario: 確認與封存限制

- **WHEN** 使用者選擇更新規劃、全部執行或封存
- **THEN** 先要求確認；只有有任務且全部完成的 change 可以封存

#### Scenario: 準備期間狀態改變

- **WHEN** session 忙碌、有待處理訊息、已切換 session、skill 不可用，或確認／準備期間 change 已變更
- **THEN** 不送出操作；送出前須重讀 change，避免只依賴事件快取

#### Scenario: 送出失敗

- **WHEN** skill 工作無法送出
- **THEN** 顯示 skill 名稱與參數供手動接續，不宣告成功

### Requirement: opsx 面板顯示所有任務與完成進度

`/opsx` 右側看板 SHALL 直接顯示 OpenSpec Tasks、目前專案所有未封存 change 的完成數／總任務數，以及各 change 的進度。清單 SHALL 包含已完成與未完成 tasks，保留 `tasks.md` 原始順序、任務編號與標題，分別使用 `[x]` 與 `[ ]` 標示；不得只顯示 next 或篩選未完成任務，也不得要求使用者到另一個原生側邊欄尋找。

#### Scenario: 顯示混合完成狀態的任務

- **WHEN** 某 change 的三項 tasks 依序為已完成、未完成、已完成
- **THEN** `/opsx` 面板依原始順序顯示三項 tasks，標記依序為 `[x]`、`[ ]`、`[x]`，該 change 進度為 `2/3`

#### Scenario: 總進度包含尚未展開的任務

- **WHEN** 兩張 change 分別完成 `2/5` 與 `1/3`，且兩張清單均為收合狀態
- **THEN** 區塊總進度顯示 `3/8`，不因預覽或展開狀態改變

### Requirement: 每張 change 可獨立展開與收合

每張 change SHALL 預設顯示原始順序的前三個 tasks，不區分完成狀態。超過三項時 SHALL 顯示「展開其餘 N 項」，N 為總任務數減三；展開後顯示所有 tasks 與「收合」。三項以內 SHALL 不顯示展開控制；操作一張 change 不得改變其他 change 的展開狀態。

#### Scenario: 展開與收合五個任務

- **WHEN** 一張 change 有五個 tasks，使用者依序展開與收合
- **THEN** 初始顯示前三項與「展開其餘 2 項」，展開後顯示五項與「收合」，收合後回到前三項

#### Scenario: 三項以內沒有額外控制

- **WHEN** 一張 change 有零至三個 tasks
- **THEN** 顯示所有現有 tasks，不顯示展開／收合控制

#### Scenario: 各 change 獨立控制

- **WHEN** 使用者展開 change-a，而 change-b 原本為收合狀態
- **THEN** change-a 顯示所有 tasks，change-b 仍只顯示前三項

### Requirement: 任務全文依面板寬度換行

任務標題 SHALL 依面板可用寬度直接換行並顯示全文，不使用省略號或固定行數裁切。續行 SHALL 對齊任務標題起點，核取標記與編號只顯示一次；預覽上限 SHALL 以三個任務計算，而非三行文字。內容超過畫面高度時 SHALL 能透過面板內同一個捲動區閱讀，不為各 change 建立巢狀捲動區。

#### Scenario: 長中文標題換行

- **WHEN** 任務標題包含中文、英文及長路徑，超過面板寬度
- **THEN** 任務全文換行且不水平溢出，續行對齊標題，所有內容均可閱讀

#### Scenario: 換行不減少預覽任務數

- **WHEN** 收合清單的第一個任務占用四行，而且該 change 有四個 tasks
- **THEN** 清單仍顯示前三個完整任務，並顯示「展開其餘 1 項」

### Requirement: 任務資料唯讀且不額外持久化

面板 SHALL 以目前解析出的 OpenSpec root 內 `openspec/changes/*/tasks.md` 作為唯一任務資料來源。載入、顯示及展開／收合 SHALL 不寫回任務、不送出執行請求、不建立額外任務檔案或資料庫；展開狀態只存在記憶體，重新開啟 TUI 後 SHALL 回到預設收合。既有明確執行任務的動作不受此唯讀呈現規則限制。

#### Scenario: 操作清單不改變任務資料

- **WHEN** 使用者開啟 `/opsx`、展開及收合清單，或點擊任務的核取標記
- **THEN** `tasks.md` 內容不變，不額外儲存待辦，也不觸發 apply、update 或 archive

#### Scenario: 重開後重新讀取現況

- **WHEN** 使用者關閉 TUI，修改 `tasks.md`，再重新開啟 TUI
- **THEN** `/opsx` 面板顯示檔案目前的任務與進度，所有 change 預設收合

### Requirement: 檔案更新保留任務並同步完成狀態

`tasks.md` 變更後，面板 SHALL 在既有檔案監看更新後重新反映任務內容、完成標記、進度與剩餘項數，不需要重開 TUI。完成任務 SHALL 留在原始位置；更新同一專案時 SHALL 保留既有 change 的展開狀態。已完成 change SHALL 在封存前繼續顯示 tasks；封存或刪除 change 後 SHALL 移除該清單及其展開狀態。

#### Scenario: 勾選不移除已完成任務

- **WHEN** 原始第二個任務由 `[ ]` 改成 `[x]`
- **THEN** 該任務仍顯示在第二個位置，標記與完成數更新，不以其他任務替補

#### Scenario: 展開期間新增或移除任務

- **WHEN** 某 change 已展開，且 `tasks.md` 新增、刪除或調整任務
- **THEN** 清單維持展開並依最新檔案順序呈現；若總數降至三項以內，不顯示多餘控制

#### Scenario: 完成後保留清單直到封存

- **WHEN** change 所有任務完成，之後移到 archive
- **THEN** 封存前顯示完成進度、「已完成」與帶有 `[x]` 的任務預覽；封存後從面板移除

### Requirement: 面板正確跟隨專案與資料狀態

面板 SHALL 跟隨目前 session 的專案與其解析出的 OpenSpec root，不顯示其他專案的 tasks。切換專案時 SHALL 清除展開狀態與舊任務。執行 `/opsx` 時，沒有 OpenSpec、沒有 change 或 root 解析失敗 SHALL 顯示對應提示；已開啟面板的狀態失效時 SHALL 清除舊任務並顯示提示。零任務 change SHALL 顯示「尚無任務」而非「已完成」。

#### Scenario: 切換至有同名 change 的其他專案

- **WHEN** 專案 A 的 change-a 已展開，使用者切換到專案 B，而 B 也有 change-a
- **THEN** 只顯示 B 的任務，B 的 change-a 預設收合，不沿用 A 的內容或展開狀態

#### Scenario: 不同空狀態有適當提示

- **WHEN** 專案沒有 OpenSpec、沒有進行中 change、某 change 沒有任務，或 root 解析失敗
- **THEN** 分別依上述規則顯示對應訊息或清除舊任務，不把零任務或解析失敗標示成已完成

#### Scenario: 偵測失敗不誤報專案不存在

- **WHEN** 目前專案已有 `openspec/`，但 root 偵測指令執行失敗、逾時或回傳無效 JSON
- **THEN** `/opsx` 顯示偵測失敗提示，不顯示「這個專案沒有 OpenSpec」，並可使用既有重新偵測入口重試

### Requirement: 任務清單沿用面板的操作範圍

任務清單 SHALL 直接使用既有 `/opsx` 面板，不新增原生側邊欄區塊或全域快捷鍵。面板取得焦點時 SHALL 以 `j/k` 或方向鍵選中 change，再以 Enter 展開／收合；滑鼠 SHALL 可點擊展開控制，並選中該 change。檔案更新 SHALL 不搶回輸入焦點。既有 footer、執行、全文、更新、封存與關閉行為 SHALL 保持不變。

#### Scenario: 不用滑鼠也能控制清單

- **WHEN** 使用者在 `/opsx` 面板以 `j/k` 或方向鍵選取某張超過三項 tasks 的 change，並按 Enter
- **THEN** 該 change 的清單切換展開狀態，不送出任務執行請求

#### Scenario: 對話輸入與既有看板不受影響

- **WHEN** `/opsx` 面板失去焦點後，使用者在輸入框打字，且 tasks 因檔案更新重繪
- **THEN** 輸入框不被任務更新搶走焦點，Enter 仍由輸入框處理，面板取得焦點後原有按鍵正常運作

### Requirement: 看板快捷鍵提示固定於底部

`/opsx` 看板 SHALL 將「v 全文、n 下一個、u 更新、a 整張、x 封存」與「Enter 展開／收合、j/k 上下移動、q/Esc 關閉」提示固定在看板底部，不隨任務清單捲動；窄面板時 SHALL 換行保留提示，不裁掉按鍵。清單超過可用高度時 SHALL 可捲動，鍵盤選取的 change 標題 SHALL 保持可見，所有既有快捷鍵功能保持不變。

#### Scenario: 長清單中仍可看到底部提示

- **WHEN** 看板有超過可用高度的 changes，使用者以鍵盤移動選取或捲動清單
- **THEN** 選取的 change 標題可見，快捷鍵提示仍留在看板底部，調整終端大小後亦維持置底
