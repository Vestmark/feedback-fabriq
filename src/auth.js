import { createHash } from "crypto";

export const AUTH_MODE = process.env.AUTH_MODE || "dev";
const OKTA_ISSUER = process.env.OKTA_ISSUER || "https://vestmark.okta.com";
const ADMINS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

if (AUTH_MODE === "dev" && process.env.NODE_ENV === "production") {
  throw new Error("AUTH_MODE=dev is not allowed when NODE_ENV=production");
}

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();

// Validates the Okta access token by asking Okta who it belongs to (userinfo).
async function userFromToken(token) {
  const key = createHash("sha256").update(token).digest("hex");
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.user;

  const res = await fetch(`${OKTA_ISSUER}/oauth2/v1/userinfo`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const info = await res.json();
  if (!info.email) return null;
  const email = info.email.toLowerCase();
  const user = { email, name: info.name || email, isAdmin: ADMINS.includes(email) };
  cache.set(key, { user, expires: Date.now() + CACHE_MS });
  return user;
}

export async function authenticate(req, res, next) {
  if (AUTH_MODE === "dev") {
    req.user = {
      email: process.env.DEV_USER_EMAIL || "dev@vestmark.com",
      name: "Dev User",
      isAdmin: true,
    };
    return next();
  }
  const m = (req.headers.authorization || "").match(/^Bearer (.+)$/);
  if (!m) return res.status(401).json({ error: "Missing or invalid Authorization header" });
  try {
    const user = await userFromToken(m[1]);
    if (!user) return res.status(401).json({ error: "Invalid or expired token" });
    req.user = user;
    next();
  } catch (err) {
    console.error("Auth error:", err);
    res.status(502).json({ error: "Could not verify token" });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: "Admin access required" });
  next();
}
