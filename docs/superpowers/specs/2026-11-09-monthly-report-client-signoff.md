# Design: client sign-off on a monthly report (Phase 3, parked — decision required)

Status: **proposed, not approved.** Nothing here is built. The open decision is in §1; the rest is a
scope that follows from it.

## 1. The decision that gates this work

The brief parked "a client sign-off flow through the review link". There are two different products
behind that sentence, and they need different data, copy and failure modes:

- **A — Approval gates publishing.** A monthly report cannot be published until the client has
  approved the exact version being published. Strongest accountability, but an agency's deliverable
  can be blocked by a client who is on holiday, and "published late" is itself a result the
  retainer customer will blame on the platform.
- **B — Approval is recorded alongside.** Any published report can be sent for review; the client's
  decision is stored per version and shown on the dashboard and the public page, but publishing
  stays the agency's call. Nothing new can block a deliverable.

**Recommendation: B now, A later behind a per-brand setting.** The decision record is the thing
that is missing today and is useful on its own; the gate is a policy the customer should opt into,
not a default we impose. A is then a small follow-on: a `require_signoff` flag whose absence makes
the publish route return `SIGNOFF_REQUIRED` — the same shape as the existing `BRANDING_REQUIRED`
gate, so no new publishing machinery.

Decision needed from the product owner: **A, B, or B-then-A** (recommended). Everything below
describes B, with the A hook noted where it matters.

## 2. What the client sees

A **review link** is a signed URL for one version of one monthly report, separate from the public
share link:

- `/r/{slug}?v={version}&s={signature}&review={reviewSignature}` renders the same report with a
  review bar above it (`Approve this report` / `Request changes`), not the published view's
  chrome.
- The review bar appears only when the review signature is valid, the version is the report's
  latest, and the link has not expired or been withdrawn. Otherwise the page is exactly today's
  public page — no hint that a review was ever possible.
- A decision is final for that version. A later version needs a new decision; the old one stays in
  the record and is shown as *approved an earlier version*, never as approval of the current one.

Copy honesty: the record says **"Approved by {name} on {date}"** where the name is supplied by the
reviewer, or `"Approved"` with no name when the link is the only identity. It is never phrased as a
signature, a contract, or a verified identity — a shared link cannot prove who clicked it, and the
existing share-link model has the same property.

## 3. Data

One migration (`101_client_report_reviews.sql`), mirroring the approval tables' conventions:

```
client_report_reviews (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  client_id uuid not null,
  report_id uuid not null,
  version_id uuid not null,
  decision text not null check (decision in ('approved', 'changes_requested')),
  reviewer_name text,                -- optional free text, ≤120 chars, trimmed
  comment text,                      -- optional, ≤2000 chars
  decided_at timestamptz not null default now(),
  review_token_hash text not null,   -- SHA-256 of the review link's token; the token itself is never stored
  unique (report_id, version_id),    -- one decision per version
  foreign key (report_id, account_id) references client_reports(id, account_id),
  foreign key (version_id, report_id) references client_report_versions(id, report_id)
)
```

- Tenancy is in the key chain, like `client_report_versions`; no row without its `account_id`.
- The four-column composite FKs keep a decision attached to the account and report that own it,
  which is the pattern `041`–`046` established for approval rows.
- The review token is a separate HMAC (`REVIEW_SHARE_SECRET` or the same `REPORT_SHARE_SECRET` with
  a different payload namespace) over `reportId + versionId + expiry`, deliberately **not** the
  public share signature: withdrawing a share link must not silently withdraw a review link, and
  rotating a share link must not invalidate a pending review.
- RLS: none (the app role bypasses it), but the table carries the same default-deny posture as
  `client_reports` and is only read through account-filtered queries. The public submission route is
  the one account-blind writer, declared in `ACCOUNT_BLIND_BY_DESIGN`.

`version_id` means a review is durable even after the version is superseded: the dashboard shows
"client approved version 2; version 4 is current".

## 4. Routes

- `POST /api/public/monthly-reports/review` — body `{ reportId, version, signature, decision, reviewerName?, comment? }`.
  Verifies the signature, that the version is the latest, and that this link's token hash matches the
  stored row being written. Rate-limited (same durable limiter as other public writes, keyed by
  token hash), constant-time signature comparison, 2 KiB body cap. Writes once: a second decision
  for the same version returns `409 DECISION_RECORDED` rather than overwriting.
- No authenticated route is needed to *send* a review link: the dashboard's existing report page
  shows a **Review link** with a copy button when a version is unpublished (and, post-publish, the
  link still resolves to the report but the bar says the decision is closed). Sending it is copying
  a link; there is no email integration in this phase (the existing share link has none either).
- `GET /r/{slug}` gains the optional `review` query param; a valid one renders the review bar in the
  reader's locale. Submission is a small client component posting to the route above.

## 5. What changes in the dashboard and the public page

- Report page: **Review status** block — *No decision yet*, *Client approved version 2 on 4 Dec*,
  *Changes requested on 4 Dec* with the comment. Revoked reports show the historical decision but no
  review link.
- Reports list: the monthly tab's status badge gains a second line only when there is a decision;
  no new colours, no new badge type.
- Public share page: unchanged. A decision is **not** rendered on the public page — it belongs to
  the agency/client relationship, not to whoever holds a share link.
- If A is turned on later: publish returns `SIGNOFF_REQUIRED` unless the current version has an
  `approved` decision; the existing stale-version confirm becomes the natural place to explain it.

## 6. Tests and gates

- Migration test: the table's constraints, the unique `(report_id, version_id)`, and the composite
  FKs (same style as `__tests__/db/client-report-migration.test.ts`).
- Store: one decision per version; cross-account read/write returns nothing; a superseded version's
  decision is still readable and is labelled as earlier.
- Route: valid submission writes exactly once; replayed submission is `409`; wrong/expired/withdrawn
  signature is `404`; a decision for a non-latest version is refused; rate limit returns `429`;
  malformed/oversized bodies `400`.
- Public page: review bar renders only for a valid review link; invalid ones render the normal page;
  decision is never shown on the public page.
- Dashboard: status block renders each state, both locales; no review link for revoked reports.
- No migration is applied by this design; the migration ships file-only and is applied under a named
  approval before the code that reads it merges.

## 7. Explicitly not in scope

- Emailing the review link, reminders, or notifications when a decision arrives (a decision could
  write an in-app notification later; not now).
- Client accounts, client logins, or identity verification beyond the link.
- Comments threaded over reports, or a per-fix approval flow (that is the existing C9d work-item
  approval model, which this design deliberately reuses conceptually but does not replace).
- PDF attachments or e-signature vendors.

## 8. Open questions for the product owner

1. A, B, or B-then-A (§1).
2. Who is the reviewer: any holder of the link, or does the agency name the contact and the link
   becomes that person's (both are implementable; the second makes the `reviewer_name` field a
   requirement rather than free text)?
3. Default review-link expiry: 14 or 30 days? (Public share links currently have none; a review link
   should not be permanent.)
4. On `changes_requested`, is a comment required? (Recommend yes: a rejection with no reason is the
   least actionable event in the flow.)
