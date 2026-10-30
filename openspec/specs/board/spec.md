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
