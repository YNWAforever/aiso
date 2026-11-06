# Runbook: make site-edit ready to send (ops + Rick)

Site-edit S1–S10 are merged, and migrations `086`–`096` are recorded on the hosted branch. The code is complete, but
**nothing can reach a developer yet**. Two things are owed outside the code:

1. **Ops** sets three secrets, Preview first, and runs the smoke test below.
2. **Rick** confirms the hand-off and receipt contract (§2) and gives us an endpoint per environment.

The full contract is in [the brief §3a](../superpowers/plans/2026-11-03-aiso-brief-post6-site-edit.md#3a-hand-off-and-receipt-contract-proposed-defaults-rick-to-confirm).
This page is the checklist. No step here changes code, runs a migration or touches production.

## 1. Ops: environment (Preview first)

| Variable | What it is | Rule |
|---|---|---|
| `SITE_EDIT_EXECUTOR_URL` | Rick's hand-off endpoint | `https://` only. Anything else reads as not connected. |
| `SITE_EDIT_EXECUTOR_SECRET` | AISO signs each hand-off with it (`X-AISO-Signature`) | At least 32 characters. Give the same value to Rick. |
| `SITE_EDIT_RECEIPT_SECRET` | Rick signs each receipt with it (`X-Rick-Signature`) | At least 32 characters. A **different** value from the executor secret. |
| `SITE_EDIT_RECEIPT_SECRET_PREVIOUS` | Optional. Accepted during a rotation window. | Leave unset until a rotation. |

- Generate each secret locally and never paste it into chat, a PR, a ticket or a log:

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

- Share the two secrets with Rick through the agreed secret channel, never email or chat.
- Set them in Vercel for **Preview only**, then redeploy Preview. Do not set Production until §3 passes on Preview.
  Every env change is a named Approve, per the HOLD list in the brief (§8).
- The receipt URL Rick must call is `${NEXT_PUBLIC_APP_URL}/api/site-edit/receipts`, and it is sent in every
  hand-off body as `receiptUrl`. On Preview that is the Preview deployment's origin only if `NEXT_PUBLIC_APP_URL` is
  set for Preview. Check it before telling Rick a URL.

### What "not connected" looks like

- Any of the first three missing or invalid (http, or a secret under 32 characters):
  - **Executor URL or executor secret:** the work item's site-edit panel shows not connected and the send button is
    disabled. No request is ever made.
  - **Receipt secret:** `POST /api/site-edit/receipts` answers `503 RECEIPT_NOT_CONFIGURED` and records nothing.

## 2. Rick: confirm the contract

Please confirm each item, or tell us what differs:

- [ ] **Endpoint** per environment (Preview and Production), accepting one `POST` per approved version.
- [ ] **Outbound signature:** verify `X-AISO-Signature: v1=<hex HMAC-SHA256(executorSecret, X-AISO-Timestamp + "." + rawBody)>`
  over the **raw** body, with `X-AISO-Timestamp` in unix seconds. `X-AISO-Job-Id` repeats `jobId`.
- [ ] **Answer within 10 seconds.** A 2xx means accepted (AISO shows "sent"). A 4xx or 5xx means refused ("failed"; it
  does not count toward the brand's 10-a-month cap). A timeout means "unknown", and it does count.
  Optionally return `{ "reference": "<your job id>" }` (≤ 200 characters), which we show for display only.
- [ ] **Idempotency:** treat `jobId` as the idempotency key. A member may re-send the same job after "unknown", and
  that must not apply the edit twice.
- [ ] **Edit kinds** (`editSpec.kind`). A job you cannot handle should answer 4xx:
  - `jsonld`: add one JSON-LD `<script type="application/ld+json">` block equal to `payload` on `targetUrl`.
  - `jsonld_remove`: remove the block equal to `payload` from `targetUrl`.
  - `meta`: set `<title>` to `title` and `<meta name="description">` content to `description`. A `null` field means
    leave it as it is. HTML-escape as usual, and leave exactly one meta description.
  - `llms_txt`: replace `https://<host>/llms.txt` with `content` (UTF-8, LF), served as `text/plain` or
    `text/markdown`, never as an HTML page.
- [ ] **Receipt:** when done or refused, `POST` the hand-off's `receiptUrl` with
  `{ jobId, status: "completed" | "rejected", url, completedAt, note? }`.
  - `url` must equal `editSpec.targetUrl` exactly.
  - `completedAt` is ISO 8601 with a zone.
  - `note` is plain text, at most 2,000 characters.
  - No other keys, and the body is at most 8 KiB.
- [ ] **Receipt signature:** `X-Rick-Timestamp` (unix seconds, within ±5 minutes) and
  `X-Rick-Signature: v1=<hex HMAC-SHA256(receiptSecret, timestamp + "." + rawBody)>`.
- [ ] **Turnaround** you commit to. Members see "sent", never "done", until a receipt arrives. A `completed` receipt
  makes AISO check the live page once, automatically.

Receipt answers, so you can tell what happened:

| Status | Body | Meaning |
|---|---|---|
| `201` | `{ received: true, replayed: false }` | Recorded. |
| `200` | `{ received: true, replayed: true }` | The identical receipt was already recorded. Safe to retry. |
| `400` / `413` | `RECEIPT_INVALID` / `RECEIPT_TOO_LARGE` | Bad shape, extra keys, or more than 8 KiB. |
| `401` | `RECEIPT_UNAUTHENTICATED` | Bad signature or stale timestamp. |
| `404` | `RECEIPT_JOB_NOT_FOUND` | Unknown `jobId`. |
| `409` | `RECEIPT_CONFLICT` / `RECEIPT_JOB_NOT_OPEN` | A different receipt is already recorded, or the job was never accepted. |
| `422` | `RECEIPT_URL_MISMATCH` | `url` is not the job's `targetUrl`. |
| `503` | `RECEIPT_NOT_CONFIGURED` / `RECEIPT_UNAVAILABLE` | Our side is not set up, or briefly down. Retry later. |

## 3. Smoke test on Preview (after §1, with Rick's staging endpoint)

Use a **test brand whose verified domain Fimmick controls**, on a Pro or Enterprise account (other plans see the
upgrade message instead of not connected). Never use a customer's
site.

1. **Signature gate:** an unsigned `POST` to `/api/site-edit/receipts` answers `401`. This proves the receipt secret is
   set.
2. **Send:** create a work item, add a `meta` edit on a test page, and submit. A second member who is an approver
   approves it and then presses Send: only the member who approved a version can send it (S11).
   Expect "sent" and Rick's reference if he returns one.
3. **Receipt:** Rick applies the edit and sends a `completed` receipt. Expect `201`. AISO runs one live check right after
   recording it, and a reload of the panel shows the result. "Found" records a verified delivery on the version.
4. **Refusal path:** send a job Rick's staging endpoint refuses with a 4xx. Expect "failed", and the monthly count
   unchanged.
5. **Cap:** no count is shown below the cap. Once a brand has 10 counted sends in the Hong Kong month, the panel says
   so and Send answers `429`. Do not burn real sends to test it: the cap is covered by tests.

Record the date, the Preview deployment and the outcome of each step in the brief before asking for Production.

## 4. Production

Only after §3 passes on Preview and Rick confirms §2 in writing, set the same variables for Production under a named
Approve (Production uses its own two secrets, not Preview's), and repeat steps 1–3 on a Fimmick-owned brand.
