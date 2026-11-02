# AISO brief — post–Stage 6: Drive/Docs act/edit path (first "operator MCP" job)

> **For the coding agent:** read `CLAUDE.md` → `AGENTS.md` → `ARCHITECTURE.md` →
> `docs/development.md`, then this brief. **§2 has blocking decisions.** Do not start
> coding until Willy has answered Q1–Q4 there. Draft PRs only. Never merge.

| | |
| --- | --- |
| ClickUp | [z8qgvcahq5](https://app.clickup.com/t/z8qgvcahq5). It is second in the post–Stage 6 sequence: honesty rename z8qgvcahq4 → **this** → site-edit z8qgvcahq6. |
| Base | `main@8dd3a21e447699bdd79fa236509f0c91b481f5b8` (Stage 6f #139). The honesty rename ([YNWAforever/aiso#140](https://github.com/YNWAforever/aiso/pull/140)) should merge first; rebase onto it. |
| Design (LOCKED) | `/workspace/docs/superpowers/specs/2026-11-02-aiso-post-stage6-plan-packaged-vs-operator-mcp-design.md`: Willy answering Luna **t223s832** (direction t221u) |
| Precondition | The design says this comes after the honesty rename. A named start from Willy is required before spend or scope changes (z8qgvcahq6 note). |
| Lane | **待確認** |
| Assembled | 2026-11-02 from `main@8dd3a21e` and the dev pack §D3. This file is not the design; where they differ, the design wins. |

## 0. Cited lock (quote, don't paraphrase)

From the LOCKED post–Stage 6 design (t223s832), as carried in the dev pack §D3:

- Split surfaces: «*Data path* (AISO backend: SERP/keywords/page-fetch under plan caps — 6e/6f) vs *MCP path* (operator tools to **act／edit** on owned workflows — **Google Drive／Google Docs first**; later Rick work pass／Rap FED for site-edit + Google properties).»
- «MCP = **act／edit**, **not** scrape／SERP／「攞資料」.»
- Open question the design leaves: «first Drive/Docs MCP job (draft in Studio? attach to answer? export brief?)».
- Non-goals: «inventing vendor $; customer MCP for SERP/scrape; Prod LIVE/cap/FEATURE/Neon flips; unbounded "change any website"; SME/Kinnso work.»

UI rule (AGENTS.md, t342s1437): «Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.»

## 1. What exists today (verified on `8dd3a21e`)

- **There is no MCP code in the app.** Every `mcp` hit under `app/` and `lib/` is the scan's MCP-card check (`lib/checks/mcpCard.ts`), which is unrelated. `.mcp.json` configures developer tooling, not the product.
- **Google OAuth exists only for Search Console.**
  - `lib/integrations/google/oauth.ts` hardcodes `scope: openid email webmasters.readonly` and the callback `/api/integrations/google/callback`. It uses PKCE, a signed consent cookie (`consent-state.ts`, 10-minute TTL), and a failure classifier (`revoked` / `forbidden` / `quota` / `unavailable` / `misconfigured`).
  - `lib/integrations/google/vault.ts` seals tokens with AES-256-GCM, using `accountId` (+ optional `purpose`) as AAD, so a Drive token can be domain-separated with `purpose: 'drive'`.
  - Migration `054` (`google_connections`) has **one row per `(account_id, google_subject)`**, and `054` is **not applied to any persistent database** yet. A second, Drive-scoped grant for the same Google login would collide with the Search Console row.
  - The Google OAuth app is **unverified**. `webmasters.readonly` is a sensitive scope, so consent shows an "unverified app" warning and the app is capped at 100 users (CLAUDE.md). Adding any scope changes what Google reviews.
- **Studio outputs an export could start from:**
  - saved replies (`lib/conversation-studio/reply.ts`)
  - private threads (6c, `081`, not applied hosted)
  - the brief composer (`brief.ts`), which seeds a new thread and is not a document
  - work-item drafts (6b, `lib/work-items/`)
  - client reports (`lib/reports/`)

## 2. Blocking decisions（ask Willy before coding）

**Q1 — What does "MCP" mean in this slice?** The lock names an "MCP path", but there is no MCP runtime to build on. There are three readings:

| Option | What gets built | Cost / risk |
| --- | --- | --- |
| **A (recommended for v1)** | AISO's backend writes to the operator's **own** Google Drive through the Google Drive API, using a Drive grant the operator gives AISO via OAuth. "MCP path" is the product surface (act/edit tools on owned workflows), not the wire protocol. | Smallest. Reuses the OAuth, vault and failure-classifier patterns. No new runtime. |
| B | AISO acts as an **MCP client** to a hosted Google Drive/Docs MCP server and calls its tools. | Needs an MCP client runtime and a hosted server we trust. Unclear auth story. |
| C | AISO exposes **its own MCP server**, so operators' AI clients (Claude, ChatGPT) can act on their AISO workspace and Drive. | Largest: a new public surface, auth and rate limits. Overlaps "customer MCP", which the lock forbids for SERP/scrape. |

This brief is written for **A**. If Willy picks B or C, §4–§6 need rewriting.

**Q2 — What is the first job?** The design leaves this open: draft in Studio, attach to an answer, or export a brief. **Recommended: "Save to Google Docs".** It creates a **new** Google Doc in the operator's Drive from one Studio thread's saved answer. It is write-only, creates rather than edits, and never reads existing Drive content. That honours «act／edit, not 攞資料». Editing an existing Doc and attaching Drive files to answers come later.

**Q3 — Who owns the connection?** **Recommended: per profile.** Each member saves into their own Drive, with an `account_id` composite FK for tenancy. Per account, as Search Console does it, would put one person's Drive behind every member's button.

**Q4 — Gate.** The pack forbids new `FEATURE_*` / `PlanFeatures` keys without a Prod flip. **Recommended:** the existing `conversation_studio` flag, plus `resolveCommercialEntitlement(...).features.platform_access.length`, plus a live Drive connection. Nothing happens until a member connects. Willy confirms there is no new flag.

**Non-blocking (defaults below unless Willy says otherwise):**
- Q5: Is the Drive scope `drive.file` alone enough? (Default: yes; see §4.2.)
- Q6: Two PRs or one? (Default: two; see §7.)
- Q7: Where does a saved Doc go: Drive root, or a folder named "AISO"? (Default: root, so no folder lookup is needed.)

## 3. Outcome (under A + the recommended answers)

A Studio member connects **their own** Google Drive once. That gives AISO a `drive.file` grant only, stored sealed and per profile. Each saved answer then has a **儲存至 Google 文件 / Save to Google Docs** action. One click creates one new Google Doc in their Drive containing the thread title, the question, the saved answer with its citations (URLs and record ids), every honesty caveat exactly as displayed (未有／待核實／缺失不等於零), and a provenance footer (AISO, brand, ISO time). The turn then shows a link to the Doc.

Not connected, revoked, missing scope, quota, outage, or an unknown outcome each produce a specific, honest state. No Doc is ever created twice by an automatic retry. AISO never lists, reads, edits or deletes any Drive file it did not create.

## 4. Implementation (option A)

### 4.1 Connection: separate from Search Console

Recommended: a **separate table**, so Search Console code and `054` stay untouched.

- Migration `084_google_drive_connections.sql` (**file-only**; no hosted apply):
  - `google_drive_connections(id, account_id, profile_id, google_subject, google_email, scopes text[], token_ciphertext bytea, token_key_id text, status, created_at, updated_at)`.
  - Status vocabulary: `active` / `needs_reconnect` / `revoked`.
  - Unique on `(profile_id)`.
  - Composite FKs `(profile_id, account_id) → profiles(id, account_id)`.
  - Copy the token/status CHECK from `054`.
  - RLS on with zero policies, plus the revoke block from `080`–`083`.
- Vault: `sealToken(refreshToken, { accountId, purpose: 'drive:' + profileId })`. A Drive token cannot be opened as a Search Console token, or as another profile's token.
- OAuth:
  - New `start` route: `POST /api/integrations/google-drive/start`. It requests `openid email https://www.googleapis.com/auth/drive.file` with `access_type=offline`, `prompt=consent`, `include_granted_scopes=false`.
  - **Callback:** prefer the existing `/api/integrations/google/callback` (its redirect URI is already registered), dispatching on a new signed `purpose` field in the consent state. The Search Console path must be byte-for-byte unchanged in behaviour, with a regression test. If dispatching makes that callback hard to reason about, use a separate callback route; that needs an ops step to register the new redirect URI.
- Disconnect: `DELETE /api/account/integrations/google-drive` revokes the token at Google (`REVOKE_URL`), then nulls the ciphertext. This mirrors `054`'s "the row stays, the credential goes".
- Failure mapping: reuse `GoogleApiError` / the classifier.
  - `400 invalid_grant` → `needs_reconnect`
  - `403` insufficient scope → `needs_reconnect`
  - `401` / `invalid_client` → `misconfigured`, **never** reconnect (the existing rule)
  - `429` → `quota`
  - `5xx` → `unavailable`

### 4.2 The Google API call

- `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart` with metadata `{ name, mimeType: 'application/vnd.google-apps.document' }` and an HTML body. Drive converts it to a Google Doc. **No Docs API is needed for v1.**
- **待核實 against Google's docs before coding:**
  - that this conversion path is still supported with `drive.file`;
  - the response fields (`id`, `webViewLink`);
  - whether `drive.file` is classified as non-sensitive. It is believed to be, but check Google's OAuth scope list; this decides whether verification is affected.
- One HTTP attempt, a 10 s deadline (`GOOGLE_TIMEOUT_MS`), **no retries**. `files.create` is not idempotent.
- Unknown outcome (a timeout or a reset after send) is recorded as `unknown`. The UI says the Doc **may** have been created, links to Drive, and offers no automatic retry. A manual retry is a new, explicit click.

### 4.3 Export ledger and route

- Migration `084` also creates the insert-only `studio_drive_exports` table:
  - `(id, account_id, client_id, profile_id, thread_id, turn_position, outcome, google_file_id, web_view_link, created_at)`
  - `outcome` is one of `created` / `failed` / `unknown`, enforced by a CHECK and mirrored by a TS constant.
  - Composite FKs to `clients(id, account_id)` and `profiles(id, account_id)`.
  - RLS closed. `aeo_app` gets INSERT/SELECT only.
- `POST /api/dashboard/clients/[clientId]/studio/exports/google-docs` with body `{ threadId: uuid, position: int }`. Order:
  1. feature flag → profile → entitlement (`403 UPGRADE_REQUIRED`) → owned active brand (404)
  2. thread owned by this profile, in this account and brand (404). This reuses the 6c thread read.
  3. Drive connection for this profile (`409 DRIVE_NOT_CONNECTED` / `DRIVE_RECONNECT`)
  4. build the document from the **saved** turn
  5. one create call
  6. write the ledger row
  7. respond `no-store`
  - Malformed JSON → `400 INVALID_STUDIO_INPUT`.
- **Never a 2xx over a failed ledger write** (CLAUDE.md). If Google created the file but the ledger insert fails, return 5xx with the link when there is one. Do not report success.
- Document content is built only from what the operator already sees for that turn: the saved reply text, citations, and the displayed snapshot statuses and excerpts. No raw vendor payloads. No numbers that aren't on screen. Vendor names follow the honesty rename (none).

### 4.4 UI

- Studio turn: a **儲存至 Google 文件 / Save to Google Docs** button next to the existing draft and brief actions.
  - When not connected, it links to the connect flow.
  - After a save, it shows the Doc link and time. On `unknown`, it shows the "may have been created" copy and a Drive link.
  - While a request is in flight, the button is disabled to prevent double clicks.
- Connections view: a **Google Drive** card (act/edit), visually separate from the evidence cards. It shows connected email or 未連接, and connect / disconnect buttons. Connecting here means the operator's own account; it is not a vendor purchase, so it doesn't conflict with the vendor-opacity lock.
- Bilingual keys under `conversationStudio.drive.*` and `connections.drive*`. Update `STRINGS.md`.
- Follow the UI rule: no explanatory paragraphs.

## 5. Tests (AC)

- **OAuth / connection:**
  - The consent URL carries exactly `openid email …/drive.file`.
  - The state `purpose` round-trips and is signed; a tampered purpose is rejected.
  - The Search Console callback path is unchanged (regression).
  - The token is sealed with `purpose: 'drive:<profile>'` and won't open under the Search Console purpose or another profile's.
  - Disconnect revokes, then nulls the ciphertext.
- **Classifier:** `invalid_grant` → reconnect, insufficient scope → reconnect, `401`/`invalid_client` → misconfigured (no mass reconnect), `429` → quota, `5xx` → unavailable.
- **Export route:**
  - 401 / 403 / 404 (foreign brand, foreign thread, another profile's thread) / 400 / 409 not connected / `no-store`.
  - Exactly one Google call per click, none on any refusal.
  - Timeout → `unknown`, with no retry.
  - Ledger insert failure → 5xx, never 2xx.
  - Content contains the honesty caveats and no vendor names.
- **SQL (PGlite):** `084` applies; RLS is on; composite FKs reject cross-account rows; the ledger CHECK vocabulary matches the TS constant; `aeo_app` grants are INSERT/SELECT only on the ledger.
- **Inventory:** add the new tables to `__tests__/integration/migrate.test.ts` (RLS set) and `__tests__/scripts/migrate-baseline-guard.test.ts`; add any account-blind read to `ACCOUNT_BLIND_BY_DESIGN` (there should be none).
- **UI:** button states (not connected / saving / saved / unknown / error) in both locales; connections card; double-click guard.
- **e2e:** a fixture-mode flow with a mocked Google endpoint. **No live Google calls in CI.**
- Full gate: typecheck, lint 0/0, unit, build, `REQUIRE_INTEGRATION_TESTS=1 npm test` in CI.

## 6. Ops prerequisites (not the agent's to do; list them in the PR)

- Enable the **Google Drive API** in the GCP project behind `GOOGLE_OAUTH_CLIENT_ID`.
- Add `drive.file` to the OAuth consent screen. If the shared callback isn't used, register the new redirect URI.
- Decide whether to submit the OAuth app for verification. It is unverified today and capped at 100 users.
- Apply `054` and `084` to hosted Neon under a named Approve. Until then, connect and save answer honestly as unavailable.
- No new env: reuse `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY` (and `_PREVIOUS`).

## 7. Slicing (default: two PRs)

1. **Connect:** migration `084` (both tables), OAuth start + callback dispatch, disconnect, the connections card, and tests.
2. **Save to Google Docs:** the export route, the document builder, the turn action, ledger writes, and tests.

Each PR: draft, `vercel.json` +1 for its branch if it's a new branch name, a Ready packet for Willy.

## 8. Out of scope

- Reading, listing, searching or editing existing Drive files. Folders beyond Q7. Sheets and Slides.
- Any data-path use of Google, such as using Drive files as evidence. That would be 「攞資料」.
- Site-edit / Rick / Rap FED (z8qgvcahq6). Option B or C runtimes unless chosen in Q1.
- Plan SKU naming, pricing, `PlanFeatures` keys, new `FEATURE_*`.

## 9. HOLD / NO_GO

- Prod/Preview LIVE, `STUDIO_LIVE_ANSWERS_PER_WEEK`, any `FEATURE_*`, any Vercel env, GCP console changes.
- Hosted Neon migrate of 054 / 081 / 082 / 083 / 084.
- Live Google calls in tests or CI; retries on `files.create`.
- Logging tokens, auth codes or connection strings (Neon errors echo full URLs; filter `postgresql://`).
- Merge, undraft, force-push shared branches.

## 10. PR titles

- `feat(studio): connect a member's Google Drive for act/edit (drive.file, per profile)`
- `feat(studio): save a Studio answer to a new Google Doc (one create, no retries)`

Each draft PR body: base SHA, files, tests, "084 file-only — hosted apply NOT run", the ops prerequisites (§6), NO_GO, cite **t223s832**. Then a Ready packet for Willy (→ Grok Master merge Ask).
