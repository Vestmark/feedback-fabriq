// Shared Okta PKCE login (same flow as the Stitch). In dev mode there is no login.
const Auth = (() => {
  let config = null;
  let token = null;

  const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, n);
  const challenge = async (v) =>
    btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const redirectUri = () => location.origin + location.pathname;

  async function login() {
    const state = rand(32), verifier = rand(64);
    sessionStorage.setItem("okta_state", state);
    sessionStorage.setItem("okta_code_verifier", verifier);
    sessionStorage.setItem("okta_redirect_params", location.search);
    sessionStorage.removeItem("okta_access_token");
    location.href = `${config.oktaIssuer}/oauth2/v1/authorize?` + new URLSearchParams({
      client_id: config.oktaClientId, response_type: "code", scope: "openid profile email",
      redirect_uri: redirectUri(), state, code_challenge: await challenge(verifier), code_challenge_method: "S256",
    });
  }

  async function handleCallback() {
    const p = new URLSearchParams(location.search);
    const code = p.get("code");
    if (!code) return false;
    if (p.get("state") !== sessionStorage.getItem("okta_state")) throw new Error("Authentication error: state mismatch");
    const res = await fetch(`${config.oktaIssuer}/oauth2/v1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code", client_id: config.oktaClientId, code,
        redirect_uri: redirectUri(), code_verifier: sessionStorage.getItem("okta_code_verifier"),
      }),
    });
    if (!res.ok) throw new Error("Failed to exchange code for token");
    token = (await res.json()).access_token;
    sessionStorage.setItem("okta_access_token", token);
    history.replaceState(null, "", location.pathname + (sessionStorage.getItem("okta_redirect_params") || ""));
    return true;
  }

  // Resolves once we are authenticated (or in dev mode). Redirects to Okta otherwise.
  async function init() {
    config = await (await fetch("/config.json")).json();
    if (config.authMode !== "okta") return { dev: true };
    if (!(await handleCallback())) {
      token = sessionStorage.getItem("okta_access_token");
      if (!token) { await login(); return new Promise(() => {}); }
    }
    return { dev: false };
  }

  // fetch() with the bearer token; an expired token sends the user back through login.
  async function api(url, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { ...opts, headers });
    if (res.status === 401 && config.authMode === "okta") { await login(); return new Promise(() => {}); }
    return res;
  }

  return { init, api };
})();
