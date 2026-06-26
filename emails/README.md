# Daily Rep — Auth email templates

Branded HTML email templates for Supabase Auth. They match the app's Blaze design (dark surfaces
`#0B0D11`/`#14171E`, orange action gradient `#FF4D2E → #FF7A1E`, Archivo/Hanken type, Charge-Bolt
mark). Each file is a complete, standalone, table-based HTML email with inline styles and an Outlook
(VML) button fallback, so it renders consistently across Gmail, Apple Mail, Outlook and mobile.

## Files → Supabase template mapping

| File | Supabase template (Auth → Emails) | Triggered by | In-app feature |
| --- | --- | --- | --- |
| [`confirm-signup.html`](confirm-signup.html) | **Confirm signup** | `signUp()` when email confirmation is on | Auth screen → Create account |
| [`reset-password.html`](reset-password.html) | **Reset password** (recovery) | `resetPasswordForEmail()` | Auth screen → "Forgot password?" → `/reset-password` |
| [`change-email.html`](change-email.html) | **Change email address** | `updateUser({ email })` | Settings → Sign-in & security → Change email |
| [`magic-link.html`](magic-link.html) | **Magic Link** | `signInWithOtp({ email })` | Auth screen → "email me a sign-in link" |
| [`reauthentication.html`](reauthentication.html) | **Reauthentication** (OTP) | sensitive change when *Secure password change* / reauth is on | Settings → Sign-in & security → Change password |

## Template variables used

These are [Supabase Go-template variables](https://supabase.com/docs/guides/auth/auth-email-templates) —
leave them exactly as written:

- `{{ .ConfirmationURL }}` — the action link (confirm / recovery / email-change / magic-link). Used by all but `reauthentication.html`.
- `{{ .Email }}` / `{{ .NewEmail }}` — current and new address. Used by `change-email.html`.
- `{{ .Token }}` — the 6-digit one-time code. Used by `reauthentication.html` (no link in that flow).

## Suggested subject lines

| Template | Subject |
| --- | --- |
| Confirm signup | `Confirm your Daily Rep account` |
| Reset password | `Reset your Daily Rep password` |
| Change email address | `Confirm your new Daily Rep email` |
| Magic Link | `Your Daily Rep sign-in link` |
| Reauthentication | `Your Daily Rep verification code` |

## Installing (hosted project — recommended)

The project's auth config lives in the shared Supabase project (`aswwhsxubqyzbrfoptoq`), so set these
in the **dashboard** (not via `supabase config push`, which is reserved for the central schema):

1. **Authentication → URL Configuration → Redirect URLs** — add the recovery/redirect target:
   `https://daily-rep.app/reset-password` (and `http://localhost:3000/reset-password` for local dev).
   The reset-password flow sends users here; it must be on the allow-list or the link is rejected.
2. **Authentication → Emails → Templates** — for each row in the table above, open the template,
   paste the matching file's contents into the **Message body (HTML)** field, and set the subject.
3. Send yourself a test from each flow and confirm rendering on a phone + desktop client.

> The logo `<img src="https://daily-rep.app/icon-192.png">` points at the production asset in `public/`.
> If you serve the app from another domain, update the `src` in each file (the wordmark is plain text,
> so the brand still reads even with images blocked).

## Installing (local dev via Supabase CLI — optional)

For `supabase start` / local testing you can wire the templates in `supabase/config.toml`. This repo
intentionally keeps `config.toml` scoped to function JWT gating, so add this only in a local/dev config:

```toml
[auth.email.template.confirmation]
subject = "Confirm your Daily Rep account"
content_path = "./emails/confirm-signup.html"

[auth.email.template.recovery]
subject = "Reset your Daily Rep password"
content_path = "./emails/reset-password.html"

[auth.email.template.email_change]
subject = "Confirm your new Daily Rep email"
content_path = "./emails/change-email.html"

[auth.email.template.magic_link]
subject = "Your Daily Rep sign-in link"
content_path = "./emails/magic-link.html"

[auth.email.template.reauthentication]
subject = "Your Daily Rep verification code"
content_path = "./emails/reauthentication.html"
```

## Notes

- **Magic Link** requires the email provider to be enabled (Authentication → Providers → Email). The
  link returns to the app origin, which must be in the **Redirect URLs** allow-list (add
  `https://daily-rep.app` and `http://localhost:3000`).
- **Reauthentication** is only sent when *Secure password change* (Authentication → Providers → Email →
  "Secure password change") or another reauth-requiring action is enabled. With it off, an in-app
  password change via `updateUser({ password })` succeeds without an email.
- **Secure email change** (Authentication → Providers → Email) sends `change-email.html` to *both* the
  old and new address; the change only applies once confirmed. Keep it on for account-takeover safety.
- These are transactional emails — no unsubscribe link is required. Keep the "automated message" footer.
