const params = new URLSearchParams(location.search);
// Client-supplied hints only; the server takes identity from the verified token.
const context = Object.fromEntries(
  ["source", "tenant", "app", "version", "page"].map((k) => [k, params.get(k) || ""]).filter(([, v]) => v)
);
let conversationHistory = [];

const escapeHtml = (s) => { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; };
// Escape first, then apply the small markdown subset, so model/user text can't inject HTML.
const renderMarkdown = (text) =>
  escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code style='background:#e2e8f0;padding:0.1rem 0.3rem;border-radius:3px;font-size:0.85em;'>$1</code>")
    .replace(/\n/g, "<br>");

async function callApi(messages) {
  const res = await Auth.api("/api/chat", { method: "POST", body: JSON.stringify({ messages, context }) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `API error ${res.status}`);
  return res.json();
}

async function submitFeedback(summary) {
  const res = await Auth.api("/api/submit", { method: "POST", body: JSON.stringify({ summary, context }) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Submit error ${res.status}`);
  return res.json();
}

async function initApp(auth) {
  const $ = (id) => document.getElementById(id);
  const chat = $("chat"), form = $("input-form"), input = $("user-input"), sendBtn = $("btn-send");
  const summaryOverlay = $("summary-overlay"), summaryPanel = $("summary-panel");
  const summaryDisplay = $("summary-display"), summaryContent = $("summary-content");
  const btnEditSummary = $("btn-edit-summary"), btnEdit = $("btn-edit"), btnCopy = $("btn-copy");
  const btnNew = $("btn-new"), btnDone = $("btn-done"), btnSubmit = $("btn-submit"), btnCancel = $("btn-cancel");
  const thankYouOverlay = $("thank-you-overlay"), badges = $("badges");

  if (auth.dev) $("dev-banner").classList.remove("hidden");
  const me = await (await Auth.api("/api/me")).json();
  const initials = (me.name || me.email || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join("");
  $("user-badge").innerHTML = `${me.isAdmin ? '<a href="admin.html">Admin</a>' : ""}<span>${escapeHtml(me.email)}</span><div class="user-avatar">${escapeHtml(initials)}</div>`;

  btnDone.classList.add("hidden");

  function addMessage(role, text, useMarkdown) {
    const div = document.createElement("div");
    div.className = `message ${role}`;
    div.innerHTML = `<div class="message-content">${useMarkdown ? renderMarkdown(text) : escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }
  function showTyping() {
    const div = document.createElement("div");
    div.className = "typing-indicator";
    div.innerHTML = '<span class="typing-label">Thinking...</span><span></span><span></span><span></span>';
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
  }

  function showSummary(summary) {
    addMessage("assistant", "Great, I've put together a summary of your feedback. Please review it below.", true);
    summaryContent.value = summary;
    summaryDisplay.innerHTML = renderMarkdown(summary);
    summaryDisplay.classList.remove("hidden");
    summaryContent.classList.add("hidden");
    btnEditSummary.textContent = "Edit Summary";
    summaryOverlay.classList.remove("hidden");
    btnDone.classList.add("hidden");
  }

  async function exchange(onError) {
    const typing = showTyping();
    try {
      const data = await callApi(conversationHistory);
      typing.remove();
      conversationHistory.push({ role: "assistant", content: data.reply });
      if (data.summary) showSummary(data.summary);
      else addMessage("assistant", data.reply, true);
    } catch (err) {
      typing.remove();
      // Drop the unanswered user turn so a retry keeps roles alternating.
      conversationHistory.pop();
      onError?.();
      addMessage("assistant", `Sorry, something went wrong: ${err.message}`, false);
    }
  }

  badges.addEventListener("click", (e) => {
    const badge = e.target.closest(".badge");
    if (!badge?.dataset.prompt) return;
    input.value = badge.dataset.prompt;
    sendBtn.disabled = false;
    form.dispatchEvent(new Event("submit"));
  });

  input.addEventListener("input", () => {
    sendBtn.disabled = input.value.trim() === "";
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) form.dispatchEvent(new Event("submit"));
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addMessage("user", text, false);
    input.value = "";
    input.style.height = "auto";
    sendBtn.disabled = true;
    conversationHistory.push({ role: "user", content: text });
    btnDone.classList.remove("hidden");
    badges.classList.add("hidden");
    await exchange();
  });

  btnDone.addEventListener("click", async () => {
    if (!conversationHistory.length) return;
    conversationHistory.push({ role: "user", content: "I'm done answering questions. Please generate the summary now." });
    btnDone.disabled = true;
    await exchange();
    btnDone.disabled = false;
  });

  btnEdit.addEventListener("click", () => {
    summaryOverlay.classList.add("hidden");
    addMessage("assistant", "No problem - what would you like to change or add?", true);
    input.focus();
  });

  btnEditSummary.addEventListener("click", () => {
    if (!summaryContent.classList.contains("hidden")) {
      summaryDisplay.innerHTML = renderMarkdown(summaryContent.value);
      summaryDisplay.classList.remove("hidden");
      summaryContent.classList.add("hidden");
      btnEditSummary.textContent = "Edit Summary";
    } else {
      summaryDisplay.classList.add("hidden");
      summaryContent.classList.remove("hidden");
      summaryContent.focus();
      btnEditSummary.textContent = "Done Editing";
    }
  });

  btnCopy.addEventListener("click", () => {
    navigator.clipboard.writeText(summaryContent.value).then(() => {
      btnCopy.textContent = "Copied!";
      setTimeout(() => { btnCopy.textContent = "Copy to Clipboard"; }, 2000);
    });
  });

  btnSubmit.addEventListener("click", async () => {
    btnSubmit.disabled = true;
    btnSubmit.textContent = "Sending...";
    try {
      const result = await submitFeedback(summaryContent.value);
      $("thank-you-ref").textContent = `Reference: ${result.ref}`;
      summaryOverlay.classList.add("hidden");
      thankYouOverlay.classList.remove("hidden");
    } catch (err) {
      alert("Failed to send feedback: " + err.message);
    } finally {
      btnSubmit.textContent = "Send Feedback";
      btnSubmit.disabled = false;
    }
  });
  $("btn-thank-you-ok").addEventListener("click", () => { thankYouOverlay.classList.add("hidden"); window.close(); });
  btnCancel.addEventListener("click", () => window.close());

  btnNew.addEventListener("click", () => {
    conversationHistory = [];
    chat.innerHTML = "";
    addMessage("assistant", "Hi! I'd love to hear your feedback. What would you like to tell us?", true);
    summaryOverlay.classList.add("hidden");
    badges.classList.remove("hidden");
    btnDone.classList.add("hidden");
    input.focus();
  });

  // Draggable summary panel
  const handle = $("summary-drag-handle");
  let dragging = false, dx = 0, dy = 0;
  handle.addEventListener("mousedown", (e) => {
    dragging = true;
    summaryPanel.classList.add("dragging");
    const r = summaryPanel.getBoundingClientRect();
    dx = e.clientX - r.left; dy = e.clientY - r.top;
    Object.assign(summaryPanel.style, { position: "fixed", left: r.left + "px", top: r.top + "px", margin: "0" });
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    summaryPanel.style.left = e.clientX - dx + "px";
    summaryPanel.style.top = e.clientY - dy + "px";
  });
  document.addEventListener("mouseup", () => { dragging = false; summaryPanel.classList.remove("dragging"); });
}

Auth.init().then(initApp).catch((err) => { document.body.textContent = err.message; });
