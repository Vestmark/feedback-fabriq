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
npm test
```

## Configuration (`.env`)

| Var | Purpose |
|---|---|
| `AUTH_MODE` | `dev` = no login, mock admin user (refused if `NODE_ENV=production`); `okta` = require Okta bearer tokens |
| `OKTA_ISSUER`, `OKTA_CLIENT_ID` | Okta app for the browser PKCE login. The app's redirect URIs must include this site's `/` and `/admin.html` |
| `ADMIN_EMAILS` | Comma-separated emails allowed into the admin API/UI (okta mode) |
| `CHAT_MODE` | `bedrock` (needs `AWS_REGION`, `AWS_PROFILE`/credentials, `BEDROCK_MODEL_ID`) or `mock` |
| `RESEND_API_KEY`, `MAIL_FROM`, `FEEDBACK_RECIPIENT` | Email on submit. If unset, feedback is still stored and marked `not_configured` |
| `DB_PATH` | SQLite file (default `./data/feedback.db`) – back this up / mount a persistent volume |

Tokens are validated by calling Okta's `/oauth2/v1/userinfo`, so user identity (and admin rights) always come from Okta, never from URL params. `source`, `tenant`, `app`, `version`, `page` query params are passed to the model as untrusted hints and saved with the item.

## Notes vs. the Stitch

The Stitch posts to `https://50azd11ve6.execute-api.us-east-1.amazonaws.com/api/{chat,submit}`. That backend is not in any repo we have; this project replaces it, so the recipient/behaviour of the old email path is not carried over – set `FEEDBACK_RECIPIENT` to taste.
