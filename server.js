import "dotenv/config";
import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { AUTH_MODE, authenticate, requireAdmin } from "./src/auth.js";
import { chat, validateMessages } from "./src/chat.js";
import { sendFeedbackEmail } from "./src/mail.js";
import { ensureAwsLogin } from "./src/aws-login.js";
import {
  STATUSES, insertFeedback, getFeedback, setEmailResult, listFeedback, updateFeedback, deleteFeedback, stats,
} from "./src/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const MAX_SUMMARY = 10000;

export const app = express();
app.use(express.json({ limit: "100kb" }));

// Public config the browser needs to start the Okta login (no secrets).
app.get("/config.json", (req, res) => {
  res.json({
    authMode: AUTH_MODE,
    oktaIssuer: process.env.OKTA_ISSUER || "https://vestmark.okta.com",
    oktaClientId: process.env.OKTA_CLIENT_ID || "",
  });
});
app.get("/health", (req, res) => res.json({ status: "ok" }));

app.get("/", (req, res) => res.sendFile(join(__dirname, "public", "index.html")));
app.use(express.static(join(__dirname, "public")));

// ---- user API ----
app.get("/api/me", authenticate, (req, res) => res.json(req.user));

app.post("/api/chat", authenticate, async (req, res) => {
  const { messages, context } = req.body || {};
  if (!validateMessages(messages)) return res.status(400).json({ error: "Invalid messages" });
  try {
    res.json(await chat({ messages, user: req.user, context }));
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Failed to process message" });
  }
});

app.post("/api/submit", authenticate, async (req, res) => {
  const { summary, context } = req.body || {};
  if (typeof summary !== "string" || !summary.trim() || summary.length > MAX_SUMMARY) {
    return res.status(400).json({ error: "Invalid summary" });
  }
  const item = insertFeedback({ summary: summary.trim(), user: req.user, context });
  // Stored first, so a mail failure never loses feedback; the outcome is recorded on the row.
  const mail = await sendFeedbackEmail(item);
  setEmailResult(item.id, mail.ok, mail.error);
  if (!mail.ok && mail.error !== "not_configured") console.error("Email failed:", mail.error);
  res.json({ ok: true, ref: item.ref, emailed: mail.ok });
});

// ---- admin API ----
const admin = express.Router();
admin.use(authenticate, requireAdmin);

const present = (r) => r && { ...r, context: JSON.parse(r.context || "{}") };
const idParam = (req) => Number.parseInt(req.params.id, 10);

admin.get("/feedback", (req, res) => {
  const limit = Math.min(Number.parseInt(req.query.limit, 10) || 50, 200);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
  const { total, rows } = listFeedback({
    status: req.query.status || undefined,
    type: req.query.type || undefined,
    q: req.query.q || undefined,
    limit,
    offset,
  });
  res.json({ total, items: rows.map(present) });
});

admin.get("/feedback/:id", (req, res) => {
  const item = getFeedback(idParam(req));
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(present(item));
});

admin.patch("/feedback/:id", (req, res) => {
  const id = idParam(req);
  if (!getFeedback(id)) return res.status(404).json({ error: "Not found" });
  const { status, priority, admin_notes } = req.body || {};
  if (status !== undefined && !STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });
  for (const v of [priority, admin_notes]) {
    if (v !== undefined && (typeof v !== "string" || v.length > 5000)) return res.status(400).json({ error: "Invalid field" });
  }
  res.json(present(updateFeedback(id, { status, priority, admin_notes })));
});

admin.delete("/feedback/:id", (req, res) => {
  if (!deleteFeedback(idParam(req))) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

admin.post("/feedback/:id/resend", async (req, res) => {
  const item = getFeedback(idParam(req));
  if (!item) return res.status(404).json({ error: "Not found" });
  const mail = await sendFeedbackEmail(item);
  setEmailResult(item.id, mail.ok, mail.error);
  res.json(present(getFeedback(item.id)));
});

admin.get("/stats", (req, res) => res.json({ ...stats(), statuses: STATUSES }));

const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
admin.get("/export.csv", (req, res) => {
  const { rows } = listFeedback({ limit: 100000 });
  const cols = ["ref", "created_at", "user_email", "type", "title", "details", "impact", "priority", "status", "admin_notes", "email_status"];
  const lines = [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))];
  res.type("text/csv").attachment("feedback.csv").send(lines.join("\n"));
});

app.use("/api/admin", admin);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if ((process.env.CHAT_MODE || "bedrock") === "bedrock") await ensureAwsLogin();
  app.listen(PORT, () => {
    console.log(`Feedback app running at http://localhost:${PORT} (auth=${AUTH_MODE}, chat=${process.env.CHAT_MODE || "bedrock"})`);
  });
}
