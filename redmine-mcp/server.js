#!/usr/bin/env node
// Redmine MCP Server — exposes Redmine REST API as MCP tools.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "child_process";

const REDMINE_URL = (process.env.REDMINE_URL || "http://192.168.1.139:58088").replace(/\/+$/, "");
const REDMINE_API_KEY = process.env.REDMINE_API_KEY || "";

async function req(method, path, { params, body } = {}) {
  if (String(method).toUpperCase() === "DELETE") {
    throw new Error("DELETE requests are disabled in this MCP — issue deletion is forbidden by policy.");
  }
  let url = `${REDMINE_URL}/${path.replace(/^\/+/, "")}`;
  if (params && Object.keys(params).length) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      qs.append(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  const headers = {
    "X-Redmine-API-Key": REDMINE_API_KEY,
    "Content-Type": "application/json",
  };
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  init.signal = ctrl.signal;

  let resp;
  try {
    resp = await fetch(url, init);
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status} ${resp.statusText} for ${method} ${url}\n${text}`);
  }
  const txt = await resp.text();
  return txt ? JSON.parse(txt) : {};
}

const text = (s) => ({ content: [{ type: "text", text: s }] });

function gitRef() {
  const run = (cmd) => { try { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };
  const branch = run("git rev-parse --abbrev-ref HEAD");
  const commit = run("git rev-parse --short HEAD");
  const tag = run("git describe --tags --exact-match");
  if (!branch && !commit) return "";
  const ref = tag || commit;
  return branch ? `branch \`${branch}\` @ \`${ref}\`` : `\`${ref}\``;
}

// Appended to all notes/descriptions — mirrors the "Co-Authored-By" footer in Claude Code git commits.
const GIT_REF = gitRef();
const AGENT_FOOTER = [
  "\n\n---",
  "*Author:* Kevin (Kai Yin Hong)",
  `*Co-authored-by:* [Claude Code](https://claude.ai/code) (claude-sonnet-4-6)`,
  GIT_REF ? `*Code ref:* ${GIT_REF}` : null,
  "*Powered by:* [upbeat-internal-ai](https://github.com/KaiYin77/upbeat-internal-ai) — internal AI skills & MCP tooling",
].filter(Boolean).join("\n");
// Strip any pre-existing agent footer before appending a fresh one, preventing duplication.
const FOOTER_PATTERN = /\n\n---\n\*Author:\* Kevin[\s\S]*$/;
const withMeta = (s) => (s ? s.replace(FOOTER_PATTERN, "") + AGENT_FOOTER : s);

const mcp = new McpServer({ name: "Redmine MCP (Claude Code Agent)", version: "0.1.0" });

// ── Projects ──────────────────────────────────────────────────────────────────

mcp.registerTool(
  "list_projects",
  {
    title: "List projects",
    description: "List all Redmine projects accessible with the configured API key.",
    inputSchema: {},
  },
  async () => {
    const data = await req("GET", "/projects.json", { params: { limit: 100 } });
    const rows = (data.projects || []).map((p) => {
      const archived = p.status === 9 ? " [archived]" : "";
      return `id=${p.id}  identifier=${p.identifier}  name=${p.name}${archived}`;
    });
    return text(rows.join("\n") || "No projects found.");
  },
);

mcp.registerTool(
  "get_project",
  {
    title: "Get project",
    description: "Get details of a single project by numeric id or string identifier.",
    inputSchema: {
      project_id: z.string().describe("Numeric id or string identifier"),
    },
  },
  async ({ project_id }) => {
    const data = await req("GET", `/projects/${project_id}.json`, {
      params: { include: "trackers,issue_categories,enabled_modules" },
    });
    const p = data.project;
    const lines = [
      `id:          ${p.id}`,
      `identifier:  ${p.identifier}`,
      `name:        ${p.name}`,
      `description: ${p.description || ""}`,
      `status:      ${p.status === 9 ? "archived" : "active"}`,
      `created_on:  ${p.created_on || ""}`,
    ];
    if (p.trackers) {
      lines.push("trackers:    " + p.trackers.map((t) => `${t.name}(${t.id})`).join(", "));
    }
    return text(lines.join("\n"));
  },
);

// ── Issues ────────────────────────────────────────────────────────────────────

mcp.registerTool(
  "list_issues",
  {
    title: "List issues",
    description: "List issues with optional filters. status_id: 'open'|'closed'|'*'|numeric. assigned_to_id: user id or 'me'.",
    inputSchema: {
      project_id: z.string().optional(),
      status_id: z.string().optional().default("open"),
      assigned_to_id: z.string().optional(),
      tracker_id: z.number().int().optional(),
      priority_id: z.number().int().optional(),
      limit: z.number().int().optional().default(25),
      offset: z.number().int().optional().default(0),
      sort: z.string().optional().default("updated_on:desc"),
    },
  },
  async (args) => {
    const params = { limit: args.limit, offset: args.offset, sort: args.sort };
    if (args.project_id) params.project_id = args.project_id;
    if (args.status_id) params.status_id = args.status_id;
    if (args.assigned_to_id) params.assigned_to_id = args.assigned_to_id;
    if (args.tracker_id !== undefined) params.tracker_id = args.tracker_id;
    if (args.priority_id !== undefined) params.priority_id = args.priority_id;

    const data = await req("GET", "/issues.json", { params });
    const issues = data.issues || [];
    const total = data.total_count ?? issues.length;
    const rows = [`total=${total}  showing offset=${args.offset}  limit=${args.limit}\n`];
    for (const i of issues) {
      const assignee = i.assigned_to?.name || "unassigned";
      rows.push(
        `#${i.id}  [${i.status.name}]  [${i.priority.name}]  ${(i.subject || "").slice(0, 80)}  (assigned→${assignee})`,
      );
    }
    return text(rows.length > 1 ? rows.join("\n") : "No issues found.");
  },
);

mcp.registerTool(
  "get_issue",
  {
    title: "Get issue",
    description: "Get full details of a single issue including description and optionally journals (notes/history).",
    inputSchema: {
      issue_id: z.number().int(),
      include_journals: z.boolean().optional().default(true),
    },
  },
  async ({ issue_id, include_journals = true }) => {
    const includes = ["children", "attachments", "relations", "changesets", "watchers"];
    if (include_journals) includes.push("journals");
    const data = await req("GET", `/issues/${issue_id}.json`, {
      params: { include: includes.join(",") },
    });
    const i = data.issue;
    const lines = [
      `id:          #${i.id}`,
      `project:     ${i.project.name}`,
      `tracker:     ${i.tracker.name}`,
      `status:      ${i.status.name}`,
      `priority:    ${i.priority.name}`,
      `author:      ${i.author.name}`,
      `assigned_to: ${i.assigned_to?.name || "unassigned"}`,
      `subject:     ${i.subject}`,
      `created_on:  ${i.created_on || ""}`,
      `updated_on:  ${i.updated_on || ""}`,
      `done_ratio:  ${i.done_ratio ?? 0}%`,
      "",
      "── Description ──",
      i.description || "(none)",
    ];
    if (include_journals && i.journals?.length) {
      lines.push("", "── Journals ──");
      for (const j of i.journals) {
        const note = (j.notes || "").trim();
        const details = (j.details || [])
          .map((d) => `${d.property} ${d.name} changed ${d.old_value} → ${d.new_value}`)
          .join("; ");
        let line = `[${j.id}] ${j.created_on}  ${j.user.name}`;
        if (note) line += `\n  ${note}`;
        if (details) line += `\n  changes: ${details}`;
        lines.push(line);
      }
    }
    return text(lines.join("\n"));
  },
);

mcp.registerTool(
  "create_issue",
  {
    title: "Create issue",
    description: "Create a new Redmine issue. Returns the new issue id and URL.",
    inputSchema: {
      project_id: z.string(),
      subject: z.string(),
      description: z.string().optional(),
      tracker_id: z.number().int().optional(),
      status_id: z.number().int().optional(),
      priority_id: z.number().int().optional(),
      assigned_to_id: z.number().int().optional(),
      parent_issue_id: z.number().int().optional(),
      fixed_version_id: z.number().int().optional(),
      estimated_hours: z.number().optional(),
      done_ratio: z.number().int().optional(),
    },
  },
  async (args) => {
    const issue = { project_id: args.project_id, subject: args.subject };
    for (const k of [
      "tracker_id",
      "status_id",
      "priority_id",
      "assigned_to_id",
      "parent_issue_id",
      "fixed_version_id",
      "estimated_hours",
      "done_ratio",
    ]) {
      if (args[k] !== undefined) issue[k] = args[k];
    }
    if (args.description !== undefined) issue.description = withMeta(args.description);
    const data = await req("POST", "/issues.json", { body: { issue } });
    const n = data.issue;
    return text(`Created issue #${n.id}: ${n.subject}\nURL: ${REDMINE_URL}/issues/${n.id}`);
  },
);

mcp.registerTool(
  "update_issue",
  {
    title: "Update issue",
    description: "Update an existing issue. All fields optional. Use notes to add a comment. Do NOT include an author/footer block in notes — it is appended automatically.",
    inputSchema: {
      issue_id: z.number().int(),
      subject: z.string().optional(),
      description: z.string().optional(),
      status_id: z.number().int().optional(),
      priority_id: z.number().int().optional(),
      assigned_to_id: z.number().int().optional(),
      fixed_version_id: z.number().int().optional(),
      done_ratio: z.number().int().optional(),
      estimated_hours: z.number().optional(),
      notes: z.string().optional(),
    },
  },
  async (args) => {
    const issue = {};
    for (const k of [
      "subject",
      "status_id",
      "priority_id",
      "assigned_to_id",
      "fixed_version_id",
      "done_ratio",
      "estimated_hours",
    ]) {
      if (args[k] !== undefined) issue[k] = args[k];
    }
    if (args.description !== undefined) issue.description = withMeta(args.description);
    if (args.notes !== undefined) issue.notes = withMeta(args.notes);
    await req("PUT", `/issues/${args.issue_id}.json`, { body: { issue } });
    return text(`Issue #${args.issue_id} updated. URL: ${REDMINE_URL}/issues/${args.issue_id}`);
  },
);

mcp.registerTool(
  "add_issue_note",
  {
    title: "Add issue note",
    description: "Add a journal note/comment to an existing issue. Do NOT include an author/footer block in notes — it is appended automatically.",
    inputSchema: {
      issue_id: z.number().int(),
      notes: z.string(),
      private: z.boolean().optional().default(false),
    },
  },
  async ({ issue_id, notes, private: priv = false }) => {
    const payload = { issue: { notes: withMeta(notes) } };
    if (priv) payload.issue.private_notes = true;
    await req("PUT", `/issues/${issue_id}.json`, { body: payload });
    return text(`Note added to issue #${issue_id}.`);
  },
);

mcp.registerTool(
  "update_journal_note",
  {
    title: "Update journal note",
    description: "Edit the text of an existing journal note by journal id. Use get_issue with include_journals=true to find journal ids. The notes text is used as-is — no agent footer is appended.",
    inputSchema: {
      journal_id: z.number().int(),
      notes: z.string(),
    },
  },
  async ({ journal_id, notes }) => {
    await req("PUT", `/journals/${journal_id}.json`, { body: { journal: { notes } } });
    return text(`Journal #${journal_id} updated.`);
  },
);

// HARD CONSTRAINT: issue deletion is intentionally not exposed.
// Do not add a delete_issue tool. Issues must be closed (status change) or archived,
// never deleted via this MCP. The HTTP DELETE verb is also disallowed in req() below.

// ── Lookups ───────────────────────────────────────────────────────────────────

mcp.registerTool(
  "list_issue_statuses",
  {
    title: "List issue statuses",
    description: "List all available issue statuses and their ids.",
    inputSchema: {},
  },
  async () => {
    const data = await req("GET", "/issue_statuses.json");
    const rows = (data.issue_statuses || []).map(
      (s) => `id=${s.id}  name=${s.name}  is_closed=${s.is_closed ?? false}`,
    );
    return text(rows.join("\n") || "No statuses found.");
  },
);

mcp.registerTool(
  "list_priorities",
  {
    title: "List priorities",
    description: "List all available issue priorities and their ids.",
    inputSchema: {},
  },
  async () => {
    const data = await req("GET", "/enumerations/issue_priorities.json");
    const rows = (data.issue_priorities || []).map(
      (p) => `id=${p.id}  name=${p.name}  is_default=${p.is_default ?? false}`,
    );
    return text(rows.join("\n") || "No priorities found.");
  },
);

mcp.registerTool(
  "list_trackers",
  {
    title: "List trackers",
    description: "List all available trackers and their ids.",
    inputSchema: {},
  },
  async () => {
    const data = await req("GET", "/trackers.json");
    const rows = (data.trackers || []).map((t) => `id=${t.id}  name=${t.name}`);
    return text(rows.join("\n") || "No trackers found.");
  },
);

mcp.registerTool(
  "list_versions",
  {
    title: "List versions",
    description: "List versions (milestones) for a project.",
    inputSchema: {
      project_id: z.string(),
    },
  },
  async ({ project_id }) => {
    const data = await req("GET", `/projects/${project_id}/versions.json`);
    const rows = (data.versions || []).map((v) => {
      const due = v.due_date || "no due date";
      return `id=${v.id}  name=${v.name}  status=${v.status}  due=${due}`;
    });
    return text(rows.join("\n") || "No versions found.");
  },
);

mcp.registerTool(
  "list_users",
  {
    title: "List users",
    description: "List Redmine users. Requires admin privileges.",
    inputSchema: {
      limit: z.number().int().optional().default(100),
    },
  },
  async ({ limit = 100 }) => {
    const data = await req("GET", "/users.json", { params: { limit } });
    const rows = (data.users || []).map(
      (u) => `id=${u.id}  login=${u.login}  name=${u.firstname} ${u.lastname}  status=${u.status ?? ""}`,
    );
    return text(rows.join("\n") || "No users found.");
  },
);

mcp.registerTool(
  "list_memberships",
  {
    title: "List memberships",
    description: "List project memberships (who has access and with which roles).",
    inputSchema: {
      project_id: z.string(),
    },
  },
  async ({ project_id }) => {
    const data = await req("GET", `/projects/${project_id}/memberships.json`);
    const rows = (data.memberships || []).map((m) => {
      const who = (m.user || m.group || {}).name || "?";
      const roles = (m.roles || []).map((r) => r.name).join(", ");
      return `${who}  roles=[${roles}]`;
    });
    return text(rows.join("\n") || "No memberships found.");
  },
);

// ── Time entries ──────────────────────────────────────────────────────────────

mcp.registerTool(
  "list_time_entries",
  {
    title: "List time entries",
    description: "List time entries. Dates in YYYY-MM-DD. user_id can be 'me' or numeric.",
    inputSchema: {
      project_id: z.string().optional(),
      issue_id: z.number().int().optional(),
      user_id: z.string().optional(),
      from_date: z.string().optional(),
      to_date: z.string().optional(),
      limit: z.number().int().optional().default(25),
    },
  },
  async (args) => {
    const params = { limit: args.limit };
    if (args.project_id) params.project_id = args.project_id;
    if (args.issue_id !== undefined) params.issue_id = args.issue_id;
    if (args.user_id) params.user_id = args.user_id;
    if (args.from_date) params.from = args.from_date;
    if (args.to_date) params.to = args.to_date;

    const data = await req("GET", "/time_entries.json", { params });
    const rows = [];
    let totalHours = 0;
    for (const e of data.time_entries || []) {
      totalHours += e.hours || 0;
      const issueRef = e.issue ? `#${e.issue.id}` : "—";
      rows.push(
        `${e.spent_on}  ${e.user.name}  ${e.hours}h  issue=${issueRef}  ${e.activity?.name || ""}  ${e.comments || ""}`,
      );
    }
    rows.push(`\nTotal: ${totalHours}h across ${rows.length} entries`);
    return text(rows.length > 1 ? rows.join("\n") : "No time entries found.");
  },
);

mcp.registerTool(
  "log_time",
  {
    title: "Log time",
    description: "Log time against an issue. spent_on YYYY-MM-DD; activity_id from list_time_entry_activities.",
    inputSchema: {
      issue_id: z.number().int(),
      hours: z.number(),
      spent_on: z.string(),
      activity_id: z.number().int(),
      comments: z.string().optional(),
    },
  },
  async ({ issue_id, hours, spent_on, activity_id, comments }) => {
    const entry = { issue_id, hours, spent_on, activity_id };
    if (comments) entry.comments = comments;
    const data = await req("POST", "/time_entries.json", { body: { time_entry: entry } });
    const te = data.time_entry;
    return text(`Logged ${te.hours}h on #${issue_id} for ${te.spent_on} (entry id=${te.id}).`);
  },
);

mcp.registerTool(
  "list_time_entry_activities",
  {
    title: "List time entry activities",
    description: "List time entry activity types (e.g. Development, Design) and their ids.",
    inputSchema: {},
  },
  async () => {
    const data = await req("GET", "/enumerations/time_entry_activities.json");
    const rows = (data.time_entry_activities || []).map(
      (a) => `id=${a.id}  name=${a.name}  is_default=${a.is_default ?? false}`,
    );
    return text(rows.join("\n") || "No activities found.");
  },
);

// ── Search ────────────────────────────────────────────────────────────────────

mcp.registerTool(
  "search_issues",
  {
    title: "Search issues",
    description: "Full-text search across issue subjects and descriptions.",
    inputSchema: {
      query: z.string(),
      project_id: z.string().optional(),
      limit: z.number().int().optional().default(25),
    },
  },
  async ({ query, project_id, limit = 25 }) => {
    const params = { q: query, issues: 1, limit };
    if (project_id) {
      params.scope = "project";
      params.project_id = project_id;
    } else {
      params.scope = "all";
    }
    const data = await req("GET", "/search.json", { params });
    const rows = (data.results || []).map(
      (r) => `#${r.id ?? "?"}  ${r.title || ""}  url=${REDMINE_URL}${r.url || ""}`,
    );
    return text(rows.join("\n") || "No results found.");
  },
);

// ── Run ───────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await mcp.connect(transport);
