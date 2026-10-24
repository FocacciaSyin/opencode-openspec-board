## Why

外掛只在 TUI 啟動時解析一次 OpenSpec root。若 `openspec/` 是啟動後才由 `openspec init` 建立，footer 與看板會一直空白，只能重開 TUI（實際案例：TUI 15:33 啟動、`openspec/` 15:35 才出現）。同一類問題也讓 `openspec/changes/` 遲到時卡在 `no-changes`。

## What Changes

- watcher 在目標目錄不存在時，改監看最近存在的上層目錄，目標出現後自動重新綁定
- root resolver 不再快取 `null` / `unresolved` 這類否定結果
- config 變動的判定加入「`openspec/` 是否存在」，避免目錄出現但尚無 `config.yaml` 時被忽略
- `/opsx` 在 `no-openspec` / `unresolved` 狀態改為重新解析，而不是只顯示提示
- 補上對應測試與 README 說明

## Capabilities

### New Capabilities

- `board`: OpenSpec 專案偵測與看板狀態的即時更新行為

### Modified Capabilities

（無）

## Impact

- `board.ts`：watcher 綁定邏輯、`createRootResolver` 快取策略、config 變動判定
- `tui.tsx`：`openBoard()` 的重試行為
- `board.test.ts`、`README.md`
- 無 API、相依套件或資料格式變更
