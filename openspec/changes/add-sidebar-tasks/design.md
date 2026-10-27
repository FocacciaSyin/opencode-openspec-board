# Design

## Context

動機見 `proposal.md`。使用者已以截圖明確指定 `/opsx` 面板為 Tasks 的顯示位置；先前新增至原生側邊欄的位置不符預期，移除該區塊，直接擴充現有看板。

- `parseTasks` 已依檔案順序取得 `id`、`title`、`done`；`loadBoard` 目前只把統計與第一個未完成任務放入 `Change`，不保留清單。
- `tui.tsx` 的 setup 已共用 `BoardState`、root resolver、config watcher 與 changes watcher。footer 與 `/opsx` 都使用這份狀態。
- 現有看板已使用 `session.panel`，宿主提供 session、寬度、焦點及全螢幕切換，不需另加側邊欄設定。
- 現有測試使用 Node test runner 驗證資料層與 dispatch，沒有 TUI 視覺測試框架。現有依賴已包含 OpenTUI 與 Solid。
- 現有 change 排序以 tasks 檔案修改時間遞減、名稱作為次序；任務排序則沿用 Markdown 順序。

## Goals / Non-Goals

**Goals:**

- 讓 footer 與 `/opsx` 看板共用同一次讀取結果，避免產生不同版本的任務資料。
- 僅新增呈現所需的任務清單與短生命週期展開狀態，讓檔案更新與重新排序不造成展開對象錯置。
- 沿用元件排版處理中文字寬與換行，不自行切字或估算終端欄寬。

**Non-Goals:**

- 不新增任務編輯器、搜尋、排序選項、完成狀態篩選、常駐歷史資料或其他 CLI。
- 不重寫 root resolver、watcher 或 Markdown 解析器；不擴大支援新的 tasks 格式。
- 保留既有看板按鍵與動作，只新增面板內 Enter 展開／收合；不建立第二套任務介面。
- 不在此變更建立完整 TUI 測試平台，也不新增依賴。

## Decisions

### 1. 直接保留解析結果，不另建任務儲存

在 `Change` 加入必要的 `tasks: Task[]`，由 `loadBoard` 放入同次 `parseTasks` 的結果；既有 `done`、`total`、`next` 與 mtime 排序不變。所有建構 `Change` 的 fixture 一併調整。

看板直接以 `tasks` 呈現，取代原本只有 next 的一行，不依 `done` 篩選。總進度與各 change 進度仍計入所有任務。初始預覽使用前三個 tasks；展開後使用全部 tasks，額外項數為 `total - 3`。`next` 繼續供既有 `n` 與 `v` 動作使用。

替代方案是另讀檔案或儲存一份 JSON；這會增加 watcher、同步與生命週期問題，且違反直接讀現況的需求，因此不採用。

### 2. 直接擴充既有看板，共用狀態與 root 解析

在 `tui.tsx` 的 `Board` 內顯示 `OpenSpec Tasks`、進度、change 與完整任務列，不註冊 `sidebar.content`。沿用語意化 theme token，不新增硬編碼配色。

面板與 prompt footer 使用 reactive effect 跟隨 slot 的 sessionID，並共用 setup 內既有 state 與 watcher；不在每個 change 或每次展開時讀檔或建立 watcher。面板取得 state 前先核對 active session 與專案目錄，避免切換時顯示舊專案；保留既有過期非同步結果防護。

使用者回報 `/opsx` 顯示「這個專案沒有 OpenSpec」後，已以真實 `runContext`／`resolveRoot` 邊界重現：Node 與 Bun 都在約 5.3 秒遭原本五秒上限終止；只延長等待時，同一指令約 7.5 秒成功返回正確 root。明確指定 Windows shell 並未排除此現象，沒有證據支持更換執行方式。將 CLI 上限調整為三十秒；執行失敗或 JSON 無效時，若本機已有 `openspec/`，回報 unresolved，不再當成專案不存在；真正沒有 OpenSpec 的目錄仍保持隱藏。此修正落實原先的解析失敗提示要求，不新增第二種 root 來源或退回猜測目錄。

同一專案內切換 session 不視為切換專案。解析 root 沿用 `openspec context --json`，包含既有 store root 支援。非 active session 的面板不驅動全域專案切換，也不顯示其他 session 的資料。

不另做獨立資料服務或多專案快取，因目前外掛就是單一跟隨專案模型。

### 3. 展開狀態以專案與 change 名稱識別，僅放記憶體

在 setup 中保留目前專案各 change 的展開狀態，讓滑鼠與面板內 Enter 共用同一切換動作。以穩定的 change 名稱識別，不使用列表索引或每次讀取新建的物件身分。

- 更新同一專案時，現有 change 的展開狀態保留。
- 專案切換時清空；change 封存或刪除時移除其狀態，重新新增同名 change 時預設收合。
- 清單縮減至三項以內時不顯示控制；只要 change 仍存在，保留其原有展開意圖，後續新增任務時沿用。
- 狀態不寫入 `context.storage`、任務檔案或其他檔案。TUI 重開後重設；外掛重新載入時也可重設。

這比持久化 UI 偏好更符合本次單純呈現現況的範圍，也不需要處理設定遷移。

### 4. 換行使用任務列排版，不沿用看板的截斷函式

每個 task 以水平列呈現：左側是固定內容的 `[x]`／`[ ]` 與任務編號，右側是可縮放、依可用寬度換行的完整標題。標題子區塊的寬度須能縮小，避免長英文或路徑撐出面板；任務內容不使用現有 `fit`、清除 Markdown 的 `clean`、字串 slice、省略號或固定高度限制。

所有 changes 與 tasks 共用看板內同一個 scrollbox，不為每張 change 增加巢狀捲動。展開後顯示所有 tasks，接受長清單需要更多捲動的代價。窄終端沿用宿主的面板全螢幕呈現。

核取標記不註冊修改任務的事件；保留既有 `v` 動作，但閱讀目前清單不需要再開全文對話框。

### 5. 展開控制使用滑鼠與面板內 Enter

滑鼠點擊「展開其餘 N 項」／「收合」時，選中該 change、讓面板取得焦點，再切換清單。點擊 change 標題也可選中該張，不會執行任務。

鍵盤使用既有 `j/k`／方向鍵選中 change，新增 scoped `return` binding 對應 Enter 展開／收合；三項以內停用切換。不新增全域命令面板入口或全域字母快捷鍵；移除先前為原生側邊欄設計的 select dialog 與過期選擇防護。

宿主只在面板持有焦點時啟用此 keymap。開啟面板與使用者點擊時可以取得焦點，檔案更新與重新繪製不主動搶焦點。選取索引依目前清單長度取有效範圍，清單縮減後仍可顯示與操作同一個有效選取位置。

### 6. 狀態提示與現有功能分離

- 沿用 `/opsx` 開啟前對沒有 OpenSpec、沒有 change 與 unresolved 的 toast；不強制開啟空面板。
- 已開啟面板若狀態改變，`no-openspec` 顯示中性的「尚無可顯示的 OpenSpec 任務」，`no-changes` 顯示「目前沒有進行中的 change」，`unresolved` 顯示解析訊息，均不呈現舊 tasks。
- `ready`：顯示統計與每張 change；零任務顯示「尚無任務」，`total > 0 && done === total` 顯示「已完成」，並保留 tasks 預覽及展開功能。

現有載入器會把 tasks 檔案不存在或讀取失敗當成空清單，本次保留該容錯行為，不額外承諾區分檔案權限錯誤；因此零任務也絕不可標成已完成。

### 補充決策：看板快捷鍵提示固定置底

看板根容器填滿宿主提供的高度，標題與底部提示不縮小，中間 changes 使用可縮放的捲動區。快捷鍵提示使用完整換行，不沿用會裁切按鍵的 `fit`。鍵盤選取、展開或縮放時，標記待定位，於 scrollbox 的 `renderBefore` 取得本次排版座標後，將選中 change 的短標題捲入可視範圍；不依賴只在成功輸出時才發出的 frame 完成事件，也不使用尚未量測的舊座標或捲入可能高於 viewport 的整張 change。短標題固定一行高度，避免離屏文字被當成零高度；不新增常駐 listener 或計時器。保留原有按鍵功能並加入 Enter 提示。

停用 scrollbox 的 viewport culling，讓離屏標題的座標也保持更新，避免快速跨越長清單後無法捲入選取項。代價是所有展開內容仍參與渲染；本次不另寫虛擬清單，若未來實際有大量任務造成效能問題，再改用能取得離屏排版座標的定位方式。

## Risks / Trade-offs

- [長標題與所有 tasks 可能占用較多高度] → 預設前三項；展開後沿用宿主捲動，以全文可閱讀優先，不偷偷截斷。
- [新讀取會建立新物件且排序可能改變] → 展開狀態以 change 名稱識別；維持既有 mtime 排序，接受存檔後 change 位置可能變動。
- [共享 state 與 session／專案切換可能短暫不同步] → 以目錄核對阻擋舊資料顯示，重用既有非同步防護，驗證同名 change 跨專案切換。
- [官方目前文件與最低支援版本可能不同] → 實作時核對安裝的 plugin 型別及宣告最低版本是否支援所用 slot／命令 API；若必須提高最低版本，先回報相容性變更，不靜默調整。
- [沒有既有 TUI 自動化測試框架] → 資料層使用既有 runner；換行、捲動、滑鼠、鍵盤與焦點以真實 TUI 驗證並記錄結果，未驗證項明列。
- [檔案監看繼承既有平台限制] → 不宣稱精確 150ms 內必定更新；驗證一般存檔、目錄稍後建立與封存情境，保留 `/opsx` 既有重試機制。

## Migration Plan

沒有資料格式或持久化資料遷移。完成實作後執行既有測試與型別檢查，再以本機外掛載入方式驗證 `/opsx`。若需回退，回退本次實作與文件變更即可，不需要清除或還原任何任務資料；不修改使用者全域設定。

## Verification

- 已確認 `@opencode/plugin@2.0.18` 與 `2.1.4` 的面板與 keymap 介面；`@opentui/core@0.6.6` 已有看板所用的 `scrollChildIntoView`、`renderBefore`、`viewportCulling` 與 `requestRender`，不需提高最低支援版本。最低版本僅做介面核對，沒有另外啟動該版本宿主。
- 偵測誤判修正已先取得兩個失敗回歸案例，修正後四個相關案例通過。Node／Bun 真實 `root-check.ts` 分別約 21.7／20.0 秒成功取得 root，證實五秒上限不足；完整單元測試為 34 項通過、0 失敗、0 略過。
- `npm test`：34 通過、0 失敗、0 略過；`npm run typecheck`、`git diff --check` 與 `openspec validate add-sidebar-tasks --strict --json` 均通過。
- 新位置的元件檢查使用真實 OpenTUI 渲染器、Solid 元件、暫存 tasks 與檔案監看；驗證前三項包含完成任務、完整換行與續行對齊、滑鼠／Enter 切換、展開時新增／刪除任務及縮至三項後恢復、完成後保留、封存移除與同名重建、跨專案同名 change 隔離、面板關閉後 prompt footer 仍跟隨 session、重載預設收合、空狀態及長清單快速移動與縮放置底。僅 CLI root 與宿主 API 使用替身，送出動作的 scope／skill 在此及既有單元測試核對，不執行模型任務。
- 元件檢查程式為暫存目錄 `C:/Users/g8113/AppData/Local/Temp/opencode/openspec-board-ui-check/panel-check.tsx`；畫面保存在 `panel-collapsed.txt`、`panel-expanded.txt`、`panel-narrow.txt`。先前原生側邊欄的檢查不作為目前面板的驗證證據。
- 真實 OpenCode 宿主檢查 `panel-host-check.py` 使用隔離的 XDG 目錄與實際外掛，已通過 `/opsx` 呈現、滑鼠及 Enter 展開／收合、全文、檔案更新、`v` 全文對話框、`u/a/x` 確認及取消、未完成封存防護、長清單選取可見、快捷鍵置底、終端縮放及重新啟動後預設收合。成功畫面位於同暫存目錄的 `panel-host-7f8c653c`，不使用原生側邊欄代替 `/opsx`。
- 補充宿主檢查已核對點擊核取標記不改檔、footer 與面板進度一致、關閉後修改 tasks 再重開會顯示新標題，以及專案內未建立額外任務儲存。快速移動曾發現間歇性定位失敗，最後改為 `renderBefore` 定位；未加診斷的實際外掛已完成整輪檢查，畫面位於 `panel-host-a710135a`，元件檢查、型別與嚴格規格驗證也再次通過。
- 首次宿主測試的 prompt 攔截未生效，`n` 請求到達免費模型後因額度限制被拒絕；已確認該隔離 session 費用與所有 token 為 0，tasks 檔案未變。後續宿主檢查不再送出 prompt，執行動作只以替身驗證，未實際執行 apply／update／archive。
- 本機 Node 22 與 Bun 1.3.10 低於 OpenTUI 0.6.8 宣告的執行版本。雖然本次渲染檢查成功，不能據此宣稱這些版本受到支援；未修改系統執行環境、全域設定或專案依賴版本。未執行其他作業系統的 TUI 檢查。
