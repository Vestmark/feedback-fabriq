import { spawnSync, execFileSync } from "node:child_process";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

const profile = process.env.AWS_PROFILE;

async function credentialsWork() {
  try {
    await fromNodeProviderChain(profile ? { profile } : {})();
    return true;
  } catch {
    return false;
  }
}

function isSsoProfile() {
  if (!profile) return false;
  for (const key of ["sso_session", "sso_start_url"]) {
    try {
      if (execFileSync("aws", ["configure", "get", key, "--profile", profile], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()) return true;
    } catch {
      // key not set for this profile (or the aws CLI is missing)
    }
  }
  return false;
}

// Called at startup when chat uses Bedrock: if the AWS credentials are missing or expired and the profile
// is an SSO profile, run `aws sso login` (opens the browser) instead of making the user remember to.
// Never throws - the server still starts, and chat reports its own error if credentials stay unavailable.
export async function ensureAwsLogin() {
  if (await credentialsWork()) return true;
  if (!isSsoProfile()) {
    console.warn(`AWS credentials unavailable${profile ? ` for profile "${profile}"` : ""} and it is not an SSO profile; chat will fail.`);
    return false;
  }
  if (!process.stdin.isTTY) {
    console.warn(`AWS SSO session expired; run: aws sso login --profile ${profile}`);
    return false;
  }
  console.log(`AWS SSO session for "${profile}" is missing or expired - starting login...`);
  const r = spawnSync("aws", ["sso", "login", "--profile", profile], { stdio: "inherit" });
  if (r.status === 0 && (await credentialsWork())) return true;
  console.warn("AWS SSO login did not complete; chat will fail until you run: aws sso login --profile " + profile);
  return false;
}
