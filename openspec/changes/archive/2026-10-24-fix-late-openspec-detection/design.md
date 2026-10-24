# Design

## Context

外掛在 `setup()` 時呼叫一次 `boot(dir)`：`openspec context --json` 解析 root → `loadBoard()` 讀 changes → 建立 watcher。之後只靠三種事件再進入：session 目錄切換、`openspec/config.yaml` 變動、`openspec/changes/` 內的檔案事件。動機見 proposal.md。

目前有三個互相遮蔽的原因讓「較晚出現的 `openspec/`」永遠偵測不到：

1. `watchConfig` 對不存在的 `openspec/` 呼叫 `fs.watch`，例外被吞掉，之後沒有任何觸發點。
2. `createRootResolver` 把 `null` 也放進快取，即使補上觸發點，重跑 `boot` 仍拿到舊的否定結果。
3. `watchConfig` 的變動判定只看 `config.yaml` 的 mtime，目錄出現但檔案還沒建立時會被判定成「沒變」。

## Goals / Non-Goals

**Goals:**

- 目錄遲到時自動恢復，且不引入輪詢
- 沒有 OpenSpec 的專案維持零輸出、零錯誤訊息
- 修正集中在 watcher 與 resolver 兩處，畫面層不動

**Non-Goals:**

- 熱重載外掛程式碼本身
- 同時監看多個專案目錄（仍只跟隨目前 session 目錄）
- 偵測「外掛啟動後才安裝 openspec CLI」的檔案事件，這條由手動重試覆蓋

## Decisions

### 1. watcher 退到最近存在的上層目錄，而不是輪詢

`fs.watch` 的目標不存在時，改監看最近存在的祖先目錄（非遞迴）。目標出現後在事件中重新綁定。

- 相較輪詢：不需要在「沒有 OpenSpec 的專案」中反覆 spawn `openspec context`。
- 相較遞迴監看整個專案根目錄：非遞迴只看直接子項，事件量小很多，對大型 repo 友善。

### 2. 只在綁定路徑改變時重新綁定

每次事件都 `close()` + `fs.watch()` 會讓 `tasks.md` 的每次存檔都重建 watcher。改成計算「理想綁定路徑」（目標存在 → 目標；否則祖先），只有與目前綁定不同才重綁。

### 3. resolver 只快取肯定結果

`null`（非 OpenSpec 專案）與 `unresolved`（store 宣告錯誤）不快取，重試時一定重問 CLI。否定結果之所以不能再快取，是因為它們是「當下檔案狀態」的函式，而這個狀態正是本次要修正的東西。

保留肯定結果的快取，讓 `switchDir` 在多 session 間切換時不必重複 spawn。

- 替代方案：加 TTL。多一個時間常數要調，且仍然會在 TTL 內卡住。
- 替代方案：每個重試點自己呼叫 `forget`。等於把正確性散在多處，容易漏。

### 4. 變動判定加入目錄存在性

`stamp` 由 `config.yaml` 的 mtime 改成「是否存在 + mtime」。這樣「`openspec/` 剛出現、`config.yaml` 還沒建」也算一次變動。

### 5. 手動重試掛在既有的 `/opsx`

`openBoard()` 在 `no-openspec` / `unresolved` 時改為先 `forget` + `boot`，成功就開面板，仍失敗才顯示原本的提示。不新增 slash command，維持單一入口。

這條補上 watcher 天生看不到的情況：`openspec` CLI 後來才裝好、PATH 修好、store 後來才註冊。

## Risks / Trade-offs

- [被監看的目錄本身被刪除時，Windows 的 `fs.watch` 不一定發事件] → 目前只影響「執行中刪掉 `openspec/`」；在 watcher 留 `shortcut:` 註記，之後真的有回報再處理。
- [祖先目錄事件變多] → 事件仍受 150ms debounce 與 stamp 比對兩層過濾，`boot` 不會被每個根目錄檔案異動觸發。
- [否定結果不快取] → 僅在切換 session 或手動重試時多一次 CLI 呼叫，成本是一個短命 process。
- [測試依賴真實檔案事件] → 沿用現有測試的等待寫法（800ms），在 CI 上有既有的時間敏感風險。
