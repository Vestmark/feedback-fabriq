import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Agent } from "node:https";
import { readFileSync } from "node:fs";
import { rootCertificates } from "node:tls";

const CHAT_MODE = process.env.CHAT_MODE || "bedrock";
const MODEL_ID = process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-haiku-4-5-20251001-v1:0";

// Behind a TLS-inspecting proxy (Zscaler) Bedrock's certificate is reissued by the proxy CA. Node reads
// NODE_EXTRA_CA_CERTS only at process start, before dotenv runs, so trust it via an explicit agent.
// `ca` replaces the default store, hence appending to rootCertificates.
function buildHttpsAgent() {
  const caPath = process.env.NODE_EXTRA_CA_CERTS;
  if (!caPath) return undefined;
  try {
    return new Agent({ ca: [...rootCertificates, readFileSync(caPath, "utf8")] });
  } catch (err) {
    console.warn(`Ignoring NODE_EXTRA_CA_CERTS: cannot read ${caPath} - ${err.message}`);
    return undefined;
  }
}

// Full provider chain (profile, env keys, SSO). The explicit handler pins HTTP/1.1, which TLS-inspecting
// proxies need; the SDK's default HTTP/2 fails with ERR_HTTP2_ERROR behind them.
const client =
  CHAT_MODE === "bedrock"
    ? new BedrockRuntimeClient({
        region: process.env.AWS_REGION || "us-east-1",
        credentials: fromNodeProviderChain(process.env.AWS_PROFILE ? { profile: process.env.AWS_PROFILE } : {}),
        requestHandler: new NodeHttpHandler({ httpsAgent: buildHttpsAgent() }),
      })
    : null;

export const MAX_MESSAGES = 60;
export const MAX_CONTENT = 4000;

const SYSTEM_PROMPT = `You are a friendly feedback assistant for Vestmark. Your job is to help users articulate their feedback clearly - whether it's a bug report, feature request, or general experience feedback.

Ask clarifying questions to gather specifics: what happened, what they expected, steps to reproduce (for bugs), who is affected, and priority/urgency.

Keep responses concise (1-3 sentences). Be warm but professional.

When the user says they are done or you have enough information, produce a structured summary in this exact format:
---SUMMARY---
**Type:** [Bug / Feature Request / General Feedback]
**Summary:** [One-line summary]
**Details:** [Full description]
**Impact:** [Who is affected and how]
**Priority:** [User's stated or implied priority]
---END---`;

const MOCK_REPLIES = [
  "Thanks for sharing that! Can you tell me more about when this happens? Is it every time or only in certain situations?",
  "I appreciate the detail. Who else on your team is affected by this? And how would you rate the urgency?",
  "Got it. And what would you *expect* to happen instead? That helps us understand the gap.",
  "That's really helpful context. Is there anything else you'd like to add, or should I put together the summary?",
];

function mockReply(messages) {
  const last = (messages[messages.length - 1]?.content || "").toLowerCase();
  if (last.includes("done") || last.includes("summary")) {
    return "---SUMMARY---\n**Type:** Feature Request\n**Summary:** User wants improved navigation\n**Details:** The sidebar navigation is difficult to use on smaller screens. User suggests a collapsible menu.\n**Impact:** All users on tablets and small laptops\n**Priority:** Medium\n---END---";
  }
  const idx = Math.min(messages.filter((m) => m.role === "assistant").length, MOCK_REPLIES.length - 1);
  return MOCK_REPLIES[idx];
}

export function validateMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) return false;
  return messages.every(
    (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.length <= MAX_CONTENT
  ) && messages[messages.length - 1].role === "user";
}

// Context values are user-controlled (query string): keep them short strings and label them as untrusted.
function contextLine(user, context = {}) {
  const safe = {};
  for (const k of ["source", "tenant", "app", "version", "page"]) {
    if (typeof context[k] === "string" && context[k]) safe[k] = context[k].slice(0, 200);
  }
  return `\n\nSession context (user identity is verified; the other fields are client-supplied hints): ${JSON.stringify({
    user: user?.email,
    ...safe,
  })}`;
}

export async function chat({ messages, user, context }) {
  const raw = CHAT_MODE === "mock" ? mockReply(messages) : await bedrockReply(messages, user, context);
  const m = raw.match(/---SUMMARY---([\s\S]*?)---END---/);
  if (m) {
    return {
      reply: raw.replace(/---SUMMARY---[\s\S]*?---END---/, "").trim() || "Here's your feedback summary:",
      summary: m[1].trim(),
    };
  }
  return { reply: raw, summary: null };
}

async function bedrockReply(messages, user, context) {
  const response = await client.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: SYSTEM_PROMPT + contextLine(user, context) }],
      messages: messages.map((m) => ({ role: m.role, content: [{ text: m.content }] })),
      inferenceConfig: { maxTokens: 1024 },
    })
  );
  return response.output.message.content[0].text;
}
