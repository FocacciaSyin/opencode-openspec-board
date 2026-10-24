# Spec Delta

## Purpose

讓看板在 OpenSpec 專案於外掛執行期間才被建立或修復時，仍能自行發現並顯示進度，不需要重啟 TUI。

## ADDED Requirements

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
