# Logged-in logic map — journeys, Studio state machine, dead ends

Date: 2026-11-18. Phase 1 of the follow-up to PR #304 (baseline:
`docs/ux/2026-11-18-logged-in-ux-review.md`). **Code reading only** — no signed-in
session. Every claim cites the code it rests on; anything the code does not settle is
listed under *Open questions*. File references are at `main` = `d19f76e`.

Abbreviations: **SME** = `FEATURE_SME_COPILOT_UI=1` (copilot IA; off in production per
`docs/ux/target-ia.md`), **Legacy** = flag off. **CS** = `components/dashboard/ConversationStudio.tsx`,
**SS** = `StudioSession.tsx`, **SV** = `StudioSecondaryViews.tsx`, **AP** = `StudioActionPanel.tsx`,
**TH** = `lib/conversation-studio/threads.ts`.

## 1. Journeys

| Step | Entry points | Gating | States (empty / loading / error / partial / locked) | Exits |
| --- | --- | --- | --- | --- |
| **Sign-in** | `requireAuth` → `/{lang}/auth/login?next=` (`lib/auth.ts:62-68`) | Profile must exist (created only by the `user.created` webhook, `app/api/webhooks/neon/route.ts:59-110`) and not be deactivated (`lib/auth.ts:32-36`) | Google / magic link errors translated (`LoginForm.tsx:24-61`); completion failure + back link (`AuthComplete.tsx:56-90`). **No profile → silent bounce to login** | `window.location.replace(next)` |
| **Account home** `/dashboard` | Sign-in, logo | Trial banner only while `source==='trial'` and unexpired (`dashboard/layout.tsx:69`) | No brands → "Start setup" (`PortfolioView.tsx:239`); capacity full → UpgradeCard; load error → text only, no retry (`dashboard/page.tsx:119-121`); skeleton `list` variant | Brand card → brand; recent scan → **public** `/result/{id}` (leaves dashboard); add brand → `/onboarding`. SME + 1 brand renders BrandToday with **no add-brand control** |
| **Onboarding** `/onboarding` | Portfolio CTA, `create_brand` next step | Session; brand capacity | 4-step wizard; `BRAND_LIMIT_REACHED` → UpgradeCard; partial seed → retry + open workspace; **non-400 errors show raw API strings** (`OnboardingWizard.tsx:286,310`) | → `/dashboard/{clientId}`. Scan-prefill jump is dead (`initialBrand` hard-coded `''`, `onboarding/page.tsx:28`) |
| **Brand home** | Brand card, sidebar | Legacy + `STUDIO_DEFAULT_HOME` + Studio enabled → redirect to `/studio` (`[clientId]/page.tsx:115-117`); SME → BrandToday; else WorkspaceHome | Not owned → 404; load error → text, no action (`:125-131`); overview skeleton | Today primary action (`lib/view-models/primary-next-step.ts`), TodayAsk → Studio, saved-discussion link |
| **Scan** `?step=scan` | Today, results empty state, "Run another" | Free → UpgradeCard (`ScanStep.tsx:134-143`); 429/403 → UpgradeCard | Manual scan: only a "Scanning…" label for up to 60 s; translated errors; **non-JSON 5xx/timeout reads as "Network error"** (`:90,103-104`) | → `?step=results&scanId=` |
| **Results** `?step=results` | Scan success, sidebar, picker | Ownership | Scored → ResultsStep; null score → "incomplete" + rescan; none → empty state + CTA (#304) | Improve, share report, rescan. Unknown `?step=foo` renders a header with no body (`:71,418`) |
| **Improve** `?step=improve` | Results, Today | `agent_recs` (Generate), `agent_progress` (Pro), `agent_competitors` (Ent.) | pending/running/error/unavailable (`AgentSection.tsx:7-12`); **409 `EXTERNAL_AGENT_CONFIGURED` / 404 shown as "nothing generated"** (`ImproveStep.tsx:98,127`) | Opportunities (SME), Reports |
| **What AI says** (monitor, observations, prompts, citations, competitors) | Sidebar / SME tabs, Today | `/prompts` needs `edit_prompts` (Pro+); alerts need `alerts`; `visibility`/`outcomes`/`enterprise` need flags | `/prompts` locked card → pricing; flag pages locked as a bare `<p>` with no action (`visibility/page.tsx:14`, `outcomes:15`, `enterprise:16`) | — |
| **Sources / Assets / Connections** | Sidebar (legacy) / avatar menu (SME), Studio Connections | SearchConsolePanel needs `FEATURE_SEARCH_CONSOLE` + `search_console` (Pro+) | Not entitled → no panel and no hint; OAuth starts only from Settings (`GoogleConnectionsPanel.tsx:143`) and returns to Settings | Settings `#google` |
| **Reports** `/reports`, `/month` | Sidebar, Results, Improve header | `client_reports_online` (Pro+) | Locked card + upgrade; `/month/report` **404s** instead (`month/report/page.tsx:30`); read failure + Retry | — |
| **Studio (Chat)** | Legacy redirect from brand home; sidebar when `conversationStudioNavEnabled()` (hidden when `STUDIO_ROLLOUT_CLIENT_IDS` is set); SME TodayAsk; `?thread=` links | `FEATURE_CONVERSATION_STUDIO` + allowlist (else redirect `?step=home`, APIs 404) | See §2 | Results/Improve/Reports links from replies and action skills |
| **Settings / Billing / Members** | Sidebar (legacy) / avatar menu (SME) | Portal link needs `stripe_customer_id`; branding needs `client_reports_online` | Status shows raw `accounts.status` (trial reads "Active"); SME puts Google/staff/branding in a closed `<details>` (`settings/page.tsx:126`); Billing load-fail + Try again (#304); portal 400 is raw JSON and returns to `/en/` (`api/stripe/portal/route.ts:11-18`) | — |

## 2. Studio state machine

**Thread** (`SS:42-69`): `saveState ∈ {unsaved (local-N id), persisted, failed}` ×
`visibility ∈ {private, shared}` × `pinned` × `archived` × `mine` × optional `branchOf`.

```
 compose ──send──▶ unsaved ──create ok──▶ persisted ──append ok──▶ persisted (+turn)
                     │                        │
                     └─create fails──▶ failed ◀─append fails (turn marked failed)
 persisted ──archive──▶ archived (server: archived_at set; hidden from every list;
                                  reachable only by typing ?thread=<id>; no UI restore)
```

- **Create** has no idempotency key; the pending promise is cached per local id even when
  it failed (`SS:235-260`), so **every later send in that thread awaits the cached `null`
  and fails** (`SS:264-268`).
- **Caps**: 200 threads per person per brand, **counting archived** (`TH:338-341`), no
  delete; 50 turns per thread (`TH:614`). Both return 409 `STUDIO_THREAD_FULL`, which the
  client shows as the generic "could not be confirmed as saved".
- **List** returns ≤ 50, pinned first; `truncated` is returned but ignored (`threads-client.ts:33`).
- **Update** (owner only) accepts `archived: false` (`TH:505-508`), but no UI sends it.

**Turn**: optimistic turn with `requestId` → saved before any model call (`CS:324`);
server composes the saved-evidence reply and is idempotent on `requestId` (`TH:566-625`).
On send the composer draft is cleared (`CS:299`). Append failure → `messageNotSent`, no
resend/edit, prompt not restored (`CS:682-683`).

**LIVE** (`studio/page.tsx:91-100`, `live-quota.ts`): flags `FEATURE_CONVERSATION_STUDIO_LIVE`
(+ `FEATURE_STUDIO_STREAMING`); platforms from `platform_access`; cap = 10/brand/week;
week starts **Monday 00:00 UTC (08:00 HKT)**. First platform preselected.
`liveAvailable` = cap>0 ∧ platforms ∧ ¬exhausted ∧ remaining≠0; `liveReady` also needs ≥1
ticked. Not ready never blocks Send — the turn is saved with a saved-evidence reply.
Outcomes: complete / failed / unknown / pending (stop or broken stream → read back, never
re-sent). A pending turn blocks Send; refresh is manual and owner-only. 429
`STUDIO_QUOTA_EXCEEDED` → exhausted; copy says the draft "stays in this tab", but it was
already cleared and retry is hidden.

**Evidence inspector**: inline Radix Dialog (no portal), focus to target / Close, focus
returns to a still-connected trigger. Shows Search Console "Pending verification" even when
not offered, and DataForSEO/Firecrawl "Not connected" when merely not queried this turn.

**Attach picker**: toggle with no Escape/outside close; null → "unavailable" with no retry;
**attachment is sticky** across sends and thread switches (`CS:137,492`), re-sending the
document with every LIVE call.

**Action skills** (SME, not staff; `AP`): `scan_brand` (needs domain), `improve_page`
(`agent_recs`), `monthly_report` (`client_reports_online`). Blockers checked on Run only.
Outcomes: 403 → rejected; 202 → pending; **any other non-2xx → "unknown / may already have
run"** (`action-outcomes.ts:151-160`), including scan 429 and improve 409/404. Run buttons
disappear until reload after any non-rejected outcome; Improve uses the page-load scan id.
Save-to-discussion: saving → saved / retry (same `requestId`) / unknown.

**Connections** (`SV:246-271`): Search Console always offers the same "View connection
scope" link whatever its status; DataForSEO/Firecrawl show an Enable toggle (and "Planned")
when "Not configured"; Drive card is hidden without `platform_access`, yet "Save to Google
Docs" shows on every saved turn and its "go to Connections" link leads to a page with no
Drive card.

## 3. Dead ends, silent failures, contradictions — ranked

Score = severity (H 3 / M 2 / L 1) × frequency (common 3 / occasional 2 / rare 1).
"Verified" = re-read by me, not only by a delegated reader.

| # | Finding | Kind | Sev × Freq | Evidence | Verified |
| --- | --- | --- | --- | --- | --- |
| 1 | **Trial/Basic first task is a locked page.** Next step `confirm_prompts` (no active prompts or context unconfirmed) links to `/prompts`, which needs `edit_prompts` — false on Free/Basic (and the trial runs on Basic) | Dead end | H×occ = 6 | `primary-next-step.ts:8`; `prompts/page.tsx:63-79`; `lib/plans/catalog.ts:103,127` | ✔ |
| 2 | **Failed thread create poisons the thread**: every later send fails, composer stays enabled, no retry | Silent failure | H×occ = 6 | `SS:237-268` | ✔ |
| 3 | **SME + one brand: no way to add a second brand** without typing `/onboarding` | Dead end | H×occ (SME only) = 6 | `dashboard/page.tsx:137-175`; no `/onboarding` link in shell/nav (grep) | ✔ |
| 4 | Composer cleared on send; `messageNotSent` and the quota-exhausted turn offer no resend and `live.exhausted` claims the draft is kept | Dead end + contradiction | M×occ = 4 | `CS:299,682-683`; `live.exhausted` | ✔ |
| 5 | Action skills report definite refusals (scan limit 429, improve 409/404) as "may already have run" | Contradiction | M×occ = 4 | `action-outcomes.ts:151-160` | — |
| 6 | Archived discussions cannot be restored from any UI (API supports it) | Dead end | M×occ = 4 | `TH:505-508`; `CS:84`; `SV:99` | ✔ (#304 review) |
| 7 | "Private to you" badge on shared and teammates' threads; Private + Shared together | Contradiction | M×common(teams) = 6 → 4* | `CS:95,713` | — |
| 8 | Execution preview promises keyword/page reads that are off by default or not in plan; no link to Connections | Contradiction | M×common = 6 → 4* | `execution-preview.ts:128-134` | — |
| 9 | "Save to Google Docs" shown without `platform_access`; failure link leads to a page with no Drive card | Dead end | M×occ = 4 | `CS:688`; `google-drive/guard.ts:23`; `SV` | — |
| 10 | Sticky attachment re-sent with every LIVE call across threads | Silent cost | M×occ = 4 | `CS:137,492` | — |
| 11 | Signed-in user with no/deactivated profile bounces to login with no message | Silent failure | H×rare = 3 | `lib/auth.ts:32-36,62-67` | ✔ |
| 12 | 200-thread cap counts archived; no delete; 409 shown as "not confirmed" | Dead end | H×rare = 3 | `TH:338-352` | ✔ |
| 13 | Settings shows "Basic · Active" during trial and "Free · Active" after expiry, no expiry notice | Contradiction | M×common = 6 → 3* | `settings/page.tsx:35-39`; `layout.tsx:69` | — |
| 14 | Onboarding shows raw English API errors (incl. zh-HK) | Silent failure | M×occ = 4 → 3* | `OnboardingWizard.tsx:286,310` | — |
| 15 | Discussions list silently truncated at 50 | Silent failure | M×occ = 4 → 3* | `TH:285-288` | — |
| 16 | Improve Generate 409/404 looks like "nothing happened" | Silent failure | M×rare = 2 | `ImproveStep.tsx:98,127` | — |
| 17 | Scan timeout/5xx shown as "Network error"; no progress beyond button label | Contradiction | M×occ = 4 → 2* | `ScanStep.tsx:90,103-104` | — |
| 18 | SME Settings hides the Google OAuth result inside a closed `<details>`; no "connected" notice | Silent | M×occ (SME + flag) = 2 | `settings/page.tsx:126` | — |
| 19 | Search Console status in Studio Connections always offers the same "View connection scope" link | Dead end | L×common = 3 | `SV:252` | — |
| 20 | Inspector shows SC "Pending verification" when not offered; DFS/Firecrawl "Not connected" when not queried | Contradiction | L×common = 3 | `StudioEvidenceInspector.tsx:148-154` | — |
| 21 | DataForSEO/Firecrawl Enable toggle + "Planned" when "Not configured" | Contradiction | L×common = 3 | `SV:177-205` | — |
| 22 | Locked flag pages (`/visibility`, `/outcomes`, `/enterprise`) are bare text, no action | Dead end | L×rare = 1 | page files above | — |
| 23 | Load errors (workspace, portfolio) and Stripe portal errors have no retry/next step | Dead end | L×rare = 1 | `[clientId]/page.tsx:126-129`; `dashboard/page.tsx:120`; portal route | — |
| 24 | `localeBadge` "Hong Kong · Traditional Chinese" in the English UI | Contradiction | L×common = 3 | `CS:103` | — |
| 25 | LIVE week resets Monday 08:00 HKT, copy says "next Monday" | Contradiction | L×common = 3 | `live-quota.ts:38-42` | — |

\* Scores marked → were lowered one step where the code shows the path depends on a flag
that is off in production or on a minority plan.

**Copy debt (not dead ends, but jargon still visible)**: "Answer digest", "restarts and
instances", "provider attempts", "token budget", "answer units", "agent use", "Pacific
dates", "canonical Pulse week", "Binding needs verification", "weekly rollup", "Finish
reason", raw UUIDs and `<code>{id} · {checkKey}</code>` in evidence, raw `item.model` and
`{ms} ms` in live evidence, and `readUnavailable` wording a load failure as "Pending
verification". zh-HK mixes colloquial (嘅/係/喺, ~57 strings) and formal (的/是/在,
~153 strings) registers, including 4 strings that mix both. Of these, `live.temporaryCap`
and `featureShellNote` are pinned by `__tests__/conversation-studio/guardrails.test.ts`.

## 4. PR #304 claims vs code

All claims in the #304 review doc check out against the code. Not fully done:

- Saved Pulse evidence still prints raw platform ids (`StudioReply.tsx:124,153`); live
  evidence still prints raw `item.model`, `{ms} ms` and finish reasons.
- `sources.unavailable` still says "Pending verification"; the staff view still shows it.
- The inspector beside-the-conversation layout holds only below 900px or with one thread:
  between 900–1100px with ≥2 threads the `max-width:1100px` rail rule wins and the
  inspector wraps below again.
- Plan names: still capitalised in two places (`BillingView`, `SettingsView`), untranslated
  "Free" in the sidebar/top bar, and **the sidebar still shows the raw plan id**
  (`DashboardSidebar.tsx:165`).
- Dates: ~12 ad-hoc formatters across `components/dashboard/**` mixing en-GB/en-US/raw
  `lang` and UTC/HK time.
- `window.confirm` remains in archive (×2) and member removal. An accessible
  `components/ui/confirm-dialog.tsx` (Radix, `role="alertdialog"`, busy + destructive
  variant) already exists and is only used by the design-system gallery.
- `pointer-coarse:` is a real Tailwind 4.2 variant and compiles; `:has(.as-inspector)`
  matches (inspector is not portalled).
- en/zh-HK key sets are identical (4,971 each); no `\r` remains; one formatting scar at
  line 5671–5672 of both files.

## 5. Open questions for the owner

1. **Basic/trial first task (#1).** Should Basic users be able to *confirm* their seeded
   questions (language/market) without full editing, or should the next step for plans
   without `edit_prompts` be different (e.g. start the first baseline)? The code does not
   say which is intended.
2. **Thread cap (#12).** Should archived threads count toward the 200 cap, and should
   there be a delete? (Schema/API change — outside Phase 3 scope unless you say so.)
3. **Archive restore (#6).** OK to add an "Archived" filter on the Discussions page with a
   Restore action (API already supports `archived: false`)?
4. **zh-HK voice.** Colloquial Cantonese (嘅/係/唔) or written formal (的/是/不)? The
   SME copilot copy leans colloquial; most older Studio copy is formal.
5. **LIVE week boundary (#25).** Is Monday 00:00 UTC intended, or should the copy say
   "Monday 8am Hong Kong time"?
6. **Sticky attachment (#10).** Intended (attach once per thread) or should it clear after
   each send / on thread switch?
7. **Trial status in Settings (#13)** touches billing presentation — in or out of scope?
8. Whether `DRIVE_UNAVAILABLE` (502) can follow a Drive file that was actually created
   (it is currently shown as "Nothing was created").
