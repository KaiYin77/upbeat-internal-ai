---
description: "Ticket 驅動開發，支援單張與並行批次模式。用法：/dev [TKT-NNN | all]"
---

# Dev — Ticket 開發模式

**引數：** `$ARGUMENTS`

你是這個專案的資深工程師。進入開發模式前，必須先確認 ticket，才能動手寫程式。

---

## Step 1 — 載入 Tickets

用 Glob 掃描以下資料夾：
- `docs/tickets/todo/*.md`
- `docs/tickets/in-progress/*.md`

引數解析規則：

| 引數 | 行為 |
|------|------|
| `TKT-NNN` | 直接進入該 ticket 的 Step 2 |
| `all` / `所有` / `全部` | 進入**批次模式**（見下方） |
| （無引數） | 列出所有票，等使用者選一張 |

---

### 單張模式輸出格式（無引數時）

```
📋 待開發 Tickets

[in-progress]
  TKT-007  [bug/high]       EMS 啟動崩潰：Unknown method 'auction'

[todo]
  TKT-008  [bug/high]       Plan 部分成交與出場 Job 競爭問題
  TKT-004  [feature/medium] 取消委託事件記錄至 transactions
  TKT-005  [feature/medium] 重掛單利用 snapshot polling 取買一賣一
  TKT-010  [bug/medium]     Postgres 連線數超限
  TKT-011  [task/low]       零股下單防護與驗證

請輸入要開發的 ticket 編號（例如 TKT-004）、`all` 進入批次模式，或說「最高優先」由我選定。
```

停在此處，等使用者回覆。

---

### 批次模式（Batch Mode）— `/dev all`

> 借鑑 `/batch` 的核心理念：先分析依賴、識別可並行的工作單元，再分波執行，而非盲目線性排隊。

#### Phase A — 依賴分析與分組

收集所有 `in-progress/` + `todo/` 的 tickets，讀取每張票的 `depends_on` 欄位與「相關檔案／模組」，進行以下分析：

1. **依賴圖** — 根據 `depends_on` 建立依賴關係，確保被依賴的票先執行
2. **檔案衝突分析** — 比對各票的「相關檔案／模組」，找出共用相同檔案的票（不可並行）
3. **分波（Wave）** — 將票分組：
   - `in-progress` 的票永遠排在 Wave 0（先收尾）
   - 無依賴 + 無檔案衝突的票 → 同一 Wave，可並行
   - 有依賴的票 → 排在其依賴完成後的下一 Wave

#### Phase B — 輸出執行計劃

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔁 批次開發模式 — 依賴分析完成

[Wave 0 — 先收尾 in-progress]
  TKT-007  [bug/high]       (in-progress) 續做未完成工作

[Wave 1 — 並行執行（無依賴、無衝突）]
  TKT-008  [bug/high]       Plan 部分成交與出場 Job 競爭問題
  TKT-010  [bug/medium]     Postgres 連線數超限

[Wave 2 — 待 Wave 1 完成後執行]
  TKT-004  [feature/medium] 取消委託事件記錄 (depends_on: TKT-010)

[Wave 3 — 線性執行（與 TKT-004 共用檔案，避免衝突）]
  TKT-005  [feature/medium] 重掛單 snapshot polling

共 N 張。Wave 1 起將並行派發 agents。
確認開始？（yes / 指定從哪個 Wave / 取消）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### Phase C — 執行

取得使用者確認後，依 Wave 順序執行：

**Wave 0（in-progress）：** 逐張確認後線性實作（避免半成品積壓）。

**Wave N 並行組（多張獨立 ticket）：**
- 對同一 Wave 內的每張票，各自執行 Step 2 → Step 3 → Step 4
- 各票獨立確認需求（Step 2）後才動工，人工驗收關卡不跳過
- 並行執行時同步回報各票進度

**Wave N 線性組（有衝突的 ticket）：**
- 逐張依序執行，一張完成 in-review 後才進下一張

每張票完成後輸出進度：
```
✅ [Wave 1 — 1/2] TKT-008 → in-review
⏳ [Wave 1 — 2/2] TKT-010 進行中...
```

**批次結束條件：**
- 所有 Wave 處理完畢 → 輸出總結（完成幾張、跳過幾張、in-review 清單）
- 使用者主動中止（保留當前進度）
- 某張票遇到無法解決的阻塞 → 停在該票 Step 3，不自動跳過
- 使用者在 Step 2 回覆「跳過」→ 跳到當前 Wave 下一張

**in-review 規則不變** — 每張完成後仍停在 in-review 等人工驗收，批次模式**不會**自動結案。

---

## Step 2 — 確認 Ticket 內容

讀取選定的 ticket 檔案，完整輸出供確認：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TKT-NNN：[標題]
類型：bug／feature／task　　優先度：high／medium／low
依賴：[depends_on 欄位，若無則顯示「無」]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

需求描述：
  [原文]

驗收條件：
  [條列]

相關檔案：
  [列表]

修改歷程（最近 3 筆）：
  [最後幾筆]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
確認開始開發？（yes / 需求有調整請說明）
```

**若使用者提出需求調整：**
- 更新 ticket 的「需求描述」或「驗收條件」
- 「修改歷程」補一筆 `[需求調整]`
- 再次輸出確認畫面

---

## Step 3 — 開始開發

使用者確認後：

1. **移動 ticket** → `docs/tickets/in-progress/`
   - 用 Bash `mv` 移動檔案
   - 更新 front-matter：`status: in-progress`、`updated: 今天`
   - 「修改歷程」補：`- YYYY-MM-DD \`[開始開發]\` 進入開發流程`

2. **讀取相關檔案** — 依「相關檔案／模組」逐一 Read，充分理解現有程式結構後再動手。

3. **實作** — 按驗收條件逐項完成。每完成一個有意義的段落，在 ticket「修改歷程」補：
   ```
   - YYYY-MM-DD `[實作]` 完成 XXX，修改 path/to/file.py
   ```

4. **發現需求需調整** → 暫停說明，更新 ticket，補 `[需求調整]`，再繼續。

5. **發現需要拆新票** → 說明原因，建議執行 `/pm new`，不悶頭擴大範圍。

---

## Step 4 — 完成實作

實作完成後：

1. **移動 ticket** → `docs/tickets/in-review/`
   - 用 Bash `mv` 移動檔案
   - 更新 front-matter：`status: in-review`、`updated: 今天`
   - 「修改歷程」補：`- YYYY-MM-DD \`[待驗收]\` 實作完成，請驗收`

2. **輸出驗收清單：**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TKT-NNN 實作完成，移至 in-review

驗收條件：
  ✅ 條件一 — [實作說明]
  ✅ 條件二 — [實作說明]
  ⬜ 條件三 — [若未完成說明原因]

修改的檔案：
  - path/to/file.py

下一步（人工驗收）：
  ⚠️  in-review = 人工 double-check 關卡，Claude 不自動移至 done
  驗收通過 → /pm close TKT-NNN
  有問題   → 說明問題，繼續修改
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 全域規則

- **不讀 ticket 不寫程式** — Step 2 確認前，不碰任何程式碼
- **每個實作段落結束後立即更新修改歷程** — 不累積到最後才寫
- **移動檔案 = 狀態變更**，front-matter `status` 與資料夾必須同步
- **發現範圍蔓延立即說明** — 不自行擴大實作範圍
- **ticket 內容以繁體中文撰寫**
- **程式碼遵循專案現有風格**
