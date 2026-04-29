# upbeat-internal-skills

A pool of Claude Code **skills** (slash commands) and **MCP servers** for internal use. Pick what you want and install only those.

---

## First-time install (one-liner)

**macOS / Linux / Git Bash:**
```bash
git clone https://github.com/KaiYin77/upbeat-internal-ai.git ~/upbeat-internal-ai && cd ~/upbeat-internal-ai && ./install.sh ticket develop wiki redmine
```

**Windows PowerShell:**
```powershell
git clone https://github.com/KaiYin77/upbeat-internal-ai.git $HOME\upbeat-internal-ai; cd $HOME\upbeat-internal-ai; .\install.ps1 ticket develop wiki redmine
```

The installer copies slash commands to `~/.claude/commands/`, runs `npm install` for MCPs, prompts for any required env vars (e.g. `REDMINE_URL`, `REDMINE_API_KEY`), and registers MCPs with `claude mcp add --scope user`. **Restart Claude Code** after install so commands and MCP servers load.

Already cloned? Skip the `git clone` step and just run the installer with the components you want.

---

## What's inside

### Skills (`.claude/commands/*.md`)

| Name | Slash command | What it does |
|------|---------------|--------------|
| `ticket` | `/ticket` | Ticket workflow on `docs/tickets/{todo,in-progress,in-review,done,archive}/` |
| `develop` | `/develop` | Pick a ticket and walk through the full implementation flow |
| `wiki` | `/wiki` | Write & maintain `docs/wiki/` from real source code |

### MCPs (`*-mcp/`)

| Name | Tools | Notes |
|------|-------|-------|
| `redmine` | `list_projects`, `list_issues`, `get_issue`, `create_issue`, `update_issue`, `add_issue_note`, `delete_issue`, `list_issue_statuses`, `list_priorities`, `list_trackers`, `list_versions`, `list_users`, `list_memberships`, `list_time_entries`, `log_time`, `list_time_entry_activities`, `search_issues`, `get_project` | Node.js. Needs `REDMINE_URL` + `REDMINE_API_KEY` |

---

## Installer reference

```powershell
.\install.ps1 <name> [<name> ...]      # install named components
.\install.ps1 --list                    # show all available skills + MCPs
.\install.ps1 --uninstall <name>        # remove a component
```

Same flags work in `./install.sh` on macOS / Linux / Git Bash. Names can be any mix of skills and MCPs in any order.

---

## Manual install (if you don't want to run the script)

### Install a skill

Copy the markdown file into your user-scope commands directory:

```powershell
# Windows
Copy-Item .\.claude\commands\ticket.md $HOME\.claude\commands\ticket.md
```
```bash
# macOS / Linux
cp .claude/commands/ticket.md ~/.claude/commands/ticket.md
```

The slash command (e.g. `/ticket`) is now available in every Claude Code session.

### Install an MCP (`redmine` example)

```bash
cd redmine-mcp && npm install
```

Then register with Claude Code (run in a normal terminal, not inside a Claude session):

```bash
claude mcp add redmine \
  --scope user \
  -e REDMINE_URL=http://your-redmine-host:port \
  -e REDMINE_API_KEY=your_api_key \
  -- node "/absolute/path/to/redmine-mcp/server.js"
```

Verify:
```bash
claude mcp list
```

Restart Claude Code, then run `/mcp` inside a session to confirm `redmine` is connected.

---

## Adding a new component to the pool

- **Skill:** drop a new `<name>.md` in `.claude/commands/` and add a row to the Skills table above.
- **MCP:** create `<name>-mcp/` with a `package.json` (Node) or `pyproject.toml` (Python) and a `server.js` / `server.py` entry point. Add a row to the MCPs table above. The installer auto-detects any folder ending in `-mcp/`.
