# Tasks

## 1. Watcher 偵測

- [x] 1.1 在 `board.ts` 加入「目標不存在時退到最近存在的上層目錄、目標出現後重綁」的綁定邏輯，只在綁定路徑改變時重建 watcher；以「目錄後建 → 收到通知」的單元測試驗證
- [x] 1.2 `watchConfig` 的變動判定加入 `openspec/` 是否存在，讓「目錄出現但尚無 `config.yaml`」也觸發；以單元測試驗證
- [x] 1.3 `watchBoard` 改用同一套綁定邏輯，讓 `openspec/changes/` 遲到時能接上；以單元測試驗證

## 2. Root resolver

- [x] 2.1 `createRootResolver` 只快取肯定的 root，`null` / `unresolved` 每次重問；以測試驗證連續兩次 resolve 會呼叫 runner 兩次
- [x] 2.2 確認肯定結果仍只快取一次、`forget` 後才重跑；以既有測試驗證

## 3. 手動重試

- [x] 3.1 `/opsx` 在 `no-openspec` / `unresolved` 時先 `forget` 再 `boot`，成功開面板、失敗維持原本提示；以手動操作驗證（無 `openspec/` 時執行顯示提示，建立後再執行可開面板）

## 4. 整合與文件

- [x] 4.1 README 補上「TUI 開著時才執行 `openspec init` 也會自動出現」與 `/opsx` 可重新偵測；確認文字與實際行為一致
- [x] 4.2 `npm test` 與 `npm run typecheck` 全數通過
- [x] 4.3 手動整合驗證：在沒有 `openspec/` 的專案開 TUI，執行 `openspec init` 後 `/opsx` 提示由「沒有 OpenSpec」變成「沒有進行中的 change」，再建立 change 後 footer 自動出現，全程不需重啟

## Workflow follow-up

- 專案審查通過後封存這個 change。
