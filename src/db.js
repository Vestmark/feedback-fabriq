import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";

const DB_PATH = process.env.DB_PATH || "./data/feedback.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    user_email TEXT,
    user_name TEXT,
    type TEXT,
    title TEXT,
    details TEXT,
    impact TEXT,
    priority TEXT,
    raw_summary TEXT NOT NULL,
    context TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'new',
    admin_notes TEXT NOT NULL DEFAULT '',
    email_status TEXT NOT NULL DEFAULT 'pending',
    email_error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
  CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
`);

export const STATUSES = ["new", "triaged", "in_progress", "done", "wont_fix"];

// Pulls the **Field:** sections out of the assistant's summary (values may span lines).
export function parseSummary(text) {
  const fields = {};
  let current = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*\*\*(.+?):\*\*\s*(.*)$/);
    if (m) {
      current = m[1].trim().toLowerCase();
      fields[current] = m[2];
    } else if (current) {
      fields[current] += "\n" + line;
    }
  }
  for (const k of Object.keys(fields)) fields[k] = fields[k].trim();
  return {
    type: fields["type"] || null,
    title: fields["summary"] || null,
    details: fields["details"] || null,
    impact: fields["impact"] || null,
    priority: fields["priority"] || null,
  };
}

function newRef() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  return `${stamp}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

export function insertFeedback({ summary, user, context }) {
  const parsed = parseSummary(summary);
  const info = db
    .prepare(
      `INSERT INTO feedback (ref, user_email, user_name, type, title, details, impact, priority, raw_summary, context)
       VALUES (@ref, @user_email, @user_name, @type, @title, @details, @impact, @priority, @raw_summary, @context)`
    )
    .run({
      ref: newRef(),
      user_email: user?.email || null,
      user_name: user?.name || null,
      ...parsed,
      raw_summary: summary,
      context: JSON.stringify(context || {}),
    });
  return getFeedback(info.lastInsertRowid);
}

export function getFeedback(id) {
  return db.prepare("SELECT * FROM feedback WHERE id = ?").get(id);
}

export function setEmailResult(id, ok, error) {
  db.prepare("UPDATE feedback SET email_status = ?, email_error = ? WHERE id = ?").run(
    ok ? "sent" : error === "not_configured" ? "not_configured" : "failed",
    ok || error === "not_configured" ? null : String(error).slice(0, 500),
    id
  );
}

export function listFeedback({ status, type, q, limit = 50, offset = 0 }) {
  const where = [];
  const args = {};
  if (status) (where.push("status = @status"), (args.status = status));
  if (type) (where.push("type = @type"), (args.type = type));
  if (q) {
    where.push("(title LIKE @q OR details LIKE @q OR user_email LIKE @q OR ref LIKE @q OR admin_notes LIKE @q)");
    args.q = `%${q}%`;
  }
  const clause = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = db.prepare(`SELECT COUNT(*) AS n FROM feedback ${clause}`).get(args).n;
  const rows = db
    .prepare(`SELECT * FROM feedback ${clause} ORDER BY created_at DESC, id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...args, limit, offset });
  return { total, rows };
}

export function updateFeedback(id, { status, priority, admin_notes }) {
  const sets = [];
  const args = { id };
  if (status !== undefined) (sets.push("status = @status"), (args.status = status));
  if (priority !== undefined) (sets.push("priority = @priority"), (args.priority = priority));
  if (admin_notes !== undefined) (sets.push("admin_notes = @admin_notes"), (args.admin_notes = admin_notes));
  if (!sets.length) return getFeedback(id);
  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  db.prepare(`UPDATE feedback SET ${sets.join(", ")} WHERE id = @id`).run(args);
  return getFeedback(id);
}

export function deleteFeedback(id) {
  return db.prepare("DELETE FROM feedback WHERE id = ?").run(id).changes > 0;
}

export function stats() {
  const byStatus = db.prepare("SELECT status, COUNT(*) AS n FROM feedback GROUP BY status").all();
  const byType = db.prepare("SELECT COALESCE(type,'Unknown') AS type, COUNT(*) AS n FROM feedback GROUP BY 1").all();
  const email = db.prepare("SELECT email_status, COUNT(*) AS n FROM feedback GROUP BY email_status").all();
  return { byStatus, byType, email };
}
