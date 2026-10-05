import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "fb-")), "t.db");
process.env.AUTH_MODE = "okta";
process.env.CHAT_MODE = "mock";
process.env.ADMIN_EMAILS = "boss@vestmark.com";

const realFetch = globalThis.fetch;
const USERS = { "tok-admin": { email: "Boss@Vestmark.com", name: "Boss" }, "tok-user": { email: "user@vestmark.com", name: "User" } };
// Stub only Okta's userinfo; everything else (our own server) goes through.
globalThis.fetch = (url, opts) => {
  if (String(url).includes("/oauth2/v1/userinfo")) {
    const u = USERS[(opts?.headers?.Authorization || "").replace("Bearer ", "")];
    return Promise.resolve(u ? new Response(JSON.stringify(u)) : new Response("{}", { status: 401 }));
  }
  return realFetch(url, opts);
};

const { app } = await import("../server.js");
let server, base;
before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); }); }));
after(() => server.close());

const call = (path, token, opts = {}) =>
  realFetch(base + path, { ...opts, headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) } });

test("requests without a valid token are rejected", async () => {
  assert.equal((await call("/api/chat", null, { method: "POST", body: "{}" })).status, 401);
  assert.equal((await call("/api/submit", "nope", { method: "POST", body: "{}" })).status, 401);
  assert.equal((await call("/api/admin/feedback", null)).status, 401);
});

test("identity comes from the token, not the request body", async () => {
  const body = JSON.stringify({ summary: "**Type:** Bug\n**Summary:** s", context: { email: "spoof@x.com" } });
  assert.equal((await call("/api/submit", "tok-user", { method: "POST", body })).status, 200);
  const list = await (await call("/api/admin/feedback", "tok-admin")).json();
  assert.equal(list.items[0].user_email, "user@vestmark.com");
});

test("non-admins get 403; allowlisted admins (case-insensitive) get in", async () => {
  assert.equal((await call("/api/admin/feedback", "tok-user")).status, 403);
  assert.equal((await call("/api/admin/stats", "tok-user")).status, 403);
  assert.equal((await call("/api/admin/feedback", "tok-admin")).status, 200);
  assert.equal((await (await call("/api/me", "tok-admin")).json()).isAdmin, true);
});
