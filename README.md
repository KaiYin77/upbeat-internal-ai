# upbeat-internal-skills

內部 AI 輔助開發工具包 — Claude Code **slash commands** (skills) + **MCP servers**。  
全公司共用，依需求挑選安裝。

> **由 [upbeat-internal-ai](https://github.com/KaiYin77/upbeat-internal-ai) 維護**  
> Internal AI tooling ecosystem for the UpbeatTech.

---

## 目錄 Contents

- [快速安裝 Quick Install](#快速安裝-quick-install)
- [Skills（Slash Commands）](#skillsslash-commands)
- [MCP Server — Redmine](#mcp-server--redmine)
- [新增元件 Adding a Component](#新增元件-adding-a-component)

---

## 快速安裝 Quick Install

```bash
# 列出所有可安裝項目 / List everything available
./install.sh --list

# 安裝全部 / Install all
./install.sh pm dev wiki redmine

# 只安裝指定項目 / Install specific components
./install.sh redmine

# 移除 / Uninstall
./install.sh --uninstall pm redmine
```

安裝完成後**重啟 Claude Code**，slash commands 與 MCP servers 即生效。  
After install, **restart Claude Code** so all commands and servers load.

---

## Skills（Slash Commands）

Skills 以 Markdown 定義，安裝後在 Claude Code 中用 `/指令名稱` 呼叫。  
Skills are Markdown files — once installed, invoke them with `/command-name` in any Claude Code session.

### `/pm` — PM 規劃與 Ticket 管理

規劃 → 開票 → 追蹤 → 驗收 → 結案 → Wiki 同步的完整循環。

| 指令 | 動作 |
|------|------|
| `/pm plan <描述>` | 結構化分析（範圍、依賴、風險、執行順序），確認後才建票 |
| `/pm` 或 `/pm new` | 從對話解析需求，自動在 `docs/tickets/todo/` 建立 tickets |
| `/pm move TKT-NNN <狀態>` | 移動至 `todo / in-progress / in-review / done / archive` |
| `/pm close TKT-NNN` | 結案並自動觸發 wiki 同步 |
| `/pm wiki TKT-NNN` | 從 `done/` ticket 沉澱 know-how 至 `docs/wiki/` |
| `/pm status` | 依資料夾列出所有 tickets |

狀態流程：

```
archive ←→ todo → in-progress → in-review →（人工驗收）→ done
```

> `in-review` 不會自動推進，需人工確認後執行 `/pm close`。

---

### `/dev` — Ticket 驅動開發（支援並行批次）

讀取 tickets，分析依賴與檔案衝突，分 Wave 執行；獨立 tickets 並行派發，完成後移至 `in-review`。

```
/dev           # 列出待開發 tickets，等待選擇
/dev TKT-007   # 直接進入指定 ticket
/dev all       # 批次模式：依賴分析 → 分 Wave → 可並行的 tickets 同時實作
```

批次模式先收尾 `in-progress`，再根據 `depends_on` 和共用檔案分析，將無衝突的 tickets 分組並行。

---

### `/wiki` — 系統知識庫

以**程式碼現況為唯一來源**，撰寫並維護 `docs/wiki/`。寫作前必須先讀程式碼，wiki 只反映「現在的系統」。

```
/wiki new <主題>       # 讀程式碼，建立新頁面
/wiki update <頁面>    # 讀程式碼，將現有頁面更新至最新狀態
/wiki audit            # 掃描程式碼，找出 wiki 覆蓋缺口或過時頁面
/wiki list             # 列出所有 wiki 頁面
/wiki search <關鍵字>  # 全文搜尋
```

---

## MCP Server — Redmine

Node.js MCP server，將 Redmine REST API 封裝為 Claude Code 可直接呼叫的 tools。  
A Node.js MCP server that exposes the Redmine REST API as Claude Code tools.

**需求 Requirements：** Node.js ≥ 18、Redmine API Key

**環境變數 Environment Variables：**

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `REDMINE_URL` | Redmine instance 網址 | `http://192.168.1.139:58088` |
| `REDMINE_API_KEY` | Redmine API key | — |

**可用 Tools：**

| 分類 | Tools |
|------|-------|
| 專案 Projects | `list_projects`, `get_project` |
| Issues | `list_issues`, `get_issue`, `create_issue`, `update_issue`, `add_issue_note`, `search_issues` |
| Metadata | `list_issue_statuses`, `list_priorities`, `list_trackers` |
| 版本 / 成員 | `list_versions`, `list_users`, `list_memberships` |
| 工時 Time | `list_time_entries`, `log_time`, `list_time_entry_activities` |

> **安全限制 Safety：** DELETE 操作被永久停用。Issues 只能關閉（變更狀態），不可刪除。

---

### Redmine Note Footer

每筆由 Claude Code 寫入 Redmine 的 note 或 description，底部會自動附加 footer：

```
---
*Author:* Kevin (Kai Yin Hong)
*Co-authored-by:* [Claude Code](https://claude.ai/code) (claude-sonnet-4-6)
*Code ref:* branch `main` @ `93274e6`
*Powered by:* [upbeat-internal-ai](https://github.com/KaiYin77/upbeat-internal-ai) — internal AI skills & MCP tooling
```

- **`Code ref`** — server 啟動時自動讀取當前 git branch + commit hash（若有 git tag 則優先顯示 tag）
- **`Powered by`** — 連結至本工具的來源 repo，方便團隊追蹤版本來源

---

## 新增元件 Adding a Component

- **Skill：** 在 `.claude/commands/` 新增 `<name>.md`，並更新上方 Skills 表格。
- **MCP：** 建立 `<name>-mcp/` 資料夾，放入 `package.json`（Node）或 `pyproject.toml`（Python）及 `server.js` / `server.py`。`install.sh` 會自動偵測所有 `*-mcp/` 結尾的資料夾。

---

## 相關資源 Related

- [upbeat-internal-ai](https://github.com/KaiYin77/upbeat-internal-ai) — 本工具所屬的 AI 工具生態系 / Parent AI tooling ecosystem
- [Claude Code Docs](https://docs.anthropic.com/claude-code) — Claude Code 官方文件
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) — Model Context Protocol TypeScript SDK
