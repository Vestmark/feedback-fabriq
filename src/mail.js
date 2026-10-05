// Sends the notification email through Resend. Returns {ok, error}; never throws.
export async function sendFeedbackEmail(item) {
  const { RESEND_API_KEY, FEEDBACK_RECIPIENT, MAIL_FROM } = process.env;
  if (!RESEND_API_KEY || !FEEDBACK_RECIPIENT) return { ok: false, error: "not_configured" };

  const text = [
    `Reference: ${item.ref}`,
    `From: ${item.user_name || ""} <${item.user_email || "unknown"}>`,
    `Submitted: ${item.created_at}`,
    "",
    item.raw_summary,
  ].join("\n");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: FEEDBACK_RECIPIENT.split(",").map((s) => s.trim()),
        subject: `[Feedback] ${item.type || "Feedback"}: ${item.title || item.ref}`,
        text,
      }),
    });
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${await res.text()}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
