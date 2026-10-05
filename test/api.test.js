import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "fb-")), "t.db");
process.env.AUTH_MODE = "dev";
process.env.CHAT_MODE = "mock";
delete process.env.RESEND_API_KEY;

const { app } = await import("../server.js");
const { parseSummary } = await import("../src/db.js");

let server, base;
before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); }); }));
after(() => server.close());

const j = (path, opts = {}) =>
  fetch(base + path, { ...opts, headers: { "Content-Type": "application/json" }, body: opts.body && JSON.stringify(opts.body) });

const SUMMARY = "**Type:** Bug\n**Summary:** Grid freezes\n**Details:** Line one\nline two\n**Impact:** All advisors\n**Priority:** High";

test("parseSummary extracts fields, including multi-line values", () => {
  const p = parseSummary(SUMMARY);
  assert.equal(p.type, "Bug");
  assert.equal(p.title, "Grid freezes");
  assert.equal(p.details, "Line one\nline two");
  assert.equal(p.priority, "High");
});

test("chat returns a reply, then a parsed summary on 'done'", async () => {
  const a = await (await j("/api/chat", { method: "POST", body: { messages: [{ role: "user", content: "hi" }] } })).json();
  assert.ok(a.reply); assert.equal(a.summary, null);
  const b = await (await j("/api/chat", { method: "POST", body: { messages: [{ role: "user", content: "I'm done. summary please" }] } })).json();
  assert.match(b.summary, /\*\*Type:\*\*/);
  assert.doesNotMatch(b.reply, /---SUMMARY---/);
});

test("chat rejects malformed history", async () => {
  for (const messages of [null, [], [{ role: "assistant", content: "x" }], [{ role: "system", content: "x" }]]) {
    assert.equal((await j("/api/chat", { method: "POST", body: { messages } })).status, 400);
  }
});

test("submit stores feedback; admin can list, update, resend and delete it", async () => {
  const sub = await (await j("/api/submit", { method: "POST", body: { summary: SUMMARY, context: { source: "https://x/y" } } })).json();
  assert.equal(sub.ok, true); assert.equal(sub.emailed, false);

  const list = await (await j("/api/admin/feedback?q=freezes")).json();
  assert.equal(list.total, 1);
  const item = list.items[0];
  assert.equal(item.title, "Grid freezes");
  assert.equal(item.user_email, "dev@vestmark.com");
  assert.equal(item.email_status, "not_configured");
  assert.equal(item.context.source, "https://x/y");

  const upd = await (await j(`/api/admin/feedback/${item.id}`, { method: "PATCH", body: { status: "triaged", admin_notes: "looking" } })).json();
  assert.equal(upd.status, "triaged"); assert.equal(upd.admin_notes, "looking");
  assert.equal((await j(`/api/admin/feedback/${item.id}`, { method: "PATCH", body: { status: "bogus" } })).status, 400);

  assert.equal((await j("/api/admin/feedback?status=done")).status, 200);
  assert.equal((await (await j("/api/admin/feedback?status=done")).json()).total, 0);

  const csv = await (await fetch(base + "/api/admin/export.csv")).text();
  assert.match(csv, /Grid freezes/);

  const st = await (await j("/api/admin/stats")).json();
  assert.equal(st.byStatus.find((s) => s.status === "triaged").n, 1);

  assert.equal((await j(`/api/admin/feedback/${item.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await j(`/api/admin/feedback/${item.id}`)).status, 404);
});

test("submit validates the summary", async () => {
  for (const summary of ["", "   ", 5, "x".repeat(10001)]) {
    assert.equal((await j("/api/submit", { method: "POST", body: { summary } })).status, 400);
  }
});

test("SQL metacharacters in search are treated as data", async () => {
  const r = await j("/api/admin/feedback?q=" + encodeURIComponent("'; DROP TABLE feedback;--"));
  assert.equal(r.status, 200);
  assert.equal((await (await j("/api/admin/stats")).json()).statuses.length, 5);
});
