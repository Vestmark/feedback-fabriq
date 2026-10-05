# feedback-fabriq

Self-hosted version of the **Vestmark AI Feedback Assistant** Fabriq Stitch (`feedback-assistant`), with the parts the Stitch leaves to an external AWS API brought in-repo:

- same UI as the Stitch (`public/index.html`, Okta PKCE login, quick-start badges, editable summary)
- `POST /api/chat` – Claude on AWS Bedrock (system prompt is **server-side**; the Stitch sends it from the browser)
- `POST /api/submit` – **stores every submission in SQLite**, then emails it (Resend) and records whether the email worked
- `/admin.html` – list / search / filter, change status & priority, add notes, resend email, delete, export CSV

## Run

```
npm install
cp .env.example .env     # defaults: AUTH_MODE=dev, CHAT_MODE=mock – no AWS or Okta needed
npm start                # http://localhost:3001  (admin: /admin.html)
                         # with CHAT_MODE=bedrock, start checks your AWS SSO session and runs `aws sso login` if it expired
npm test
```

## Configuration (`.env`)

| Var | Purpose |
|---|---|
| `AUTH_MODE` | `dev` = no login, mock admin user (refused if `NODE_ENV=production`); `okta` = require Okta bearer tokens |
| `OKTA_ISSUER`, `OKTA_CLIENT_ID` | Okta app for the browser PKCE login. The app's redirect URIs must include this site's `/` and `/admin.html` |
| `ADMIN_EMAILS` | Comma-separated emails allowed into the admin API/UI (okta mode) |
| `CHAT_MODE` | `bedrock` (needs `AWS_REGION`, `AWS_PROFILE`/credentials, `BEDROCK_MODEL_ID`) or `mock`. Uses the full AWS credential chain (SSO works) and pins HTTP/1.1 |
| `NODE_EXTRA_CA_CERTS` | Absolute path to a proxy root CA PEM (e.g. Zscaler) when TLS inspection breaks Bedrock calls |
| `RESEND_API_KEY`, `MAIL_FROM`, `FEEDBACK_RECIPIENT` | Email on submit. If unset, feedback is still stored and marked `not_configured` |
| `DB_PATH` | SQLite file (default `./data/feedback.db`) – back this up / mount a persistent volume |

Tokens are validated by calling Okta's `/oauth2/v1/userinfo`, so user identity (and admin rights) always come from Okta, never from URL params. `source`, `tenant`, `app`, `version`, `page` query params are passed to the model as untrusted hints and saved with the item.

## Notes vs. the Stitch

The Stitch posts to `https://50azd11ve6.execute-api.us-east-1.amazonaws.com/api/{chat,submit}`. That backend is not in any repo we have; this project replaces it, so the recipient/behaviour of the old email path is not carried over – set `FEEDBACK_RECIPIENT` to taste.


## The published Stitch (`stitch/`)

`stitch/index.html` is the current source of the published Fabriq Stitch `feedback-assistant` (v9). It still uses the external API for chat and email, and it also:

- saves every submission to Fabriq **shared state** (`window.fabriq.state`, manifest `stateful: true`) before calling `/api/submit`, so feedback is captured even if the API fails
- has a **View all feedback** button (also `?view=all` or `#inbox`) opening an inbox with search, status filter, editable status and notes, per-item **Copy**, **Copy all**, and CSV export

Everyone with access to the Stitch can read and edit the stored feedback. Publish changes from Claude Code with `fabriq_publish` to the same slug; the Okta redirect URI is tied to that exact Stitch URL, so a new slug needs IT to register it first.
