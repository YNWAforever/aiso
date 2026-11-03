# Brief — Studio redesign: skills, full threads, cross-account staff access

Date: 2026-11-03 · Owner: Willy · Builder: Claude Code (after a named start)
Status: **brief only — nothing built.** Reference: four Ads Copilot screenshots supplied by
Willy on 2026-11-03 (conversation, overview, settings, weekly report). They show a third
party's client data, so they are described here and **not committed**.

## Decisions recorded (Willy, 2026-11-03)

| Question | Answer |
|---|---|
| "Studio all open for other brand" | **Across accounts**: Fimmick staff can open Studio for client brands in other accounts. |
| What a skill is | **Preset task modes**: named mode with starter prompt, allowed evidence/tools, output format; a thread starts from a skill. |
| Thread organisation | **Per brand, full list**: brand switcher acts as the space; full searchable thread list, date-grouped, each tagged with its skill. |

## Reference: Ads Copilot (from the screenshots)

| Area | What it does | AISO equivalent |
|---|---|---|
| Sidebar | Product mark · **space switcher** (client, avatar) · **New conversation** · nav: Overview / Conversations / Weekly report / Settings · **Recent conversations** (title + relative time) · footer: master-account authorization, my spaces, sign out | Brand switcher = space (#15); New thread; nav Overview / Threads / Weekly report / Connections & settings; full thread list (#3); footer: Tools (#17), back to dashboard, language (#20) |
| Conversation | Header: space + thread title · user turn as a bubble · collapsible "thought for a few seconds" · **execution trace** ("17 tools": each step ✓ with its scope line, e.g. account level · date range; "9 more steps") · answer **conclusion first** (先講結論), numbered findings, tables · composer with attachments · footer "AI can be wrong; check key numbers" | Reply cards (#4) gain a trace listing the evidence reads that **actually ran** (Pulse, scan, Search Console #6, DataForSEO #7, Firecrawl #8, attached source #9) with their scope; conclusion-first layout; composer keeps attach (#9) and LIVE (#2) |
| Overview | Per-account cards: 30-day snapshot (spend, clicks, conversions, CPA), 14-day daily bars, "Open conversation analysis →". **No model call**, opens instantly | Brand snapshot cards from saved data only (scan score, Pulse share of voice, Search Console clicks, opportunities #10), each with "Open a thread on this →" |
| Weekly report | Report list → week, status **pending review**, "Mark as publishable", evidence summary cards, conclusion first, check → result table, "needs your confirmation" | Pulse weekly rollup + client reports, reusing the existing approval chain (#12) |
| Settings | **Account allowlist**: only enabled accounts are queryable in conversations; accounts come from a one-time admin authorization and are assigned to spaces, so members need no re-grant · per-account caps · space name / ID · **members & invites** | Connections (#18) + brand settings (DataForSEO/Firecrawl caps) + members. **Its authorization → assign-to-space → members model is the shape of A2** below |

Skills (#1) are not visible in the reference sidebar. Recommended placement: skill cards on the
**New thread** screen and as a chip in the composer, keeping the sidebar as clean as the reference.

## Preservation and focus (Willy, 2026-11-03)

**Keep all 23 existing Studio features**; the redesign changes layout and presentation, never
removes capability. Inventory (main@f001c91e):

| # | Feature | # | Feature |
|---|---|---|---|
| 1 | Six task starters (brief, competitors, Pulse, report, opportunity, improve) | 13 | Save to Google Docs (per-member Drive) |
| 2 | LIVE platform answers + weekly quota (6g) | 14 | Site edit JSON-LD on drafts (S1) |
| 3 | Private saved/temporary threads (6c) | 15 | Brand switcher |
| 4 | Evidence-grounded reply cards, honesty states | 16 | ⌘K palette |
| 5 | Evidence inspector (scan + Pulse) | 17 | Tools page (≈15 dashboard tools) |
| 6 | Search Console in-answer (6d) + binding state | 18 | Connections page |
| 7 | DataForSEO live SERP (6e) | 19 | Studio as brand default home |
| 8 | Firecrawl, 1 URL/turn (6f) | 20 | en / zh-HK, zh-HK typography |
| 9 | Attach one approved source (6a) | 21 | Dark mode, full-bleed layout, mobile drawer |
| 10 | HK content opportunities (6h) | 22 | 72-cell visual/a11y matrix |
| 11 | Documents view | 23 | Honesty naming (no vendor names) |
| 12 | Save as work-item draft (6b) | | |

**R1 focus: #1 (task starters → skills), #3 (threads → full list), #15 (brand switcher → space).**
Every other feature keeps working unchanged inside the new shell; R1's e2e must exercise each
of them at least once (open, use, no regression) in both locales, and the a11y matrix (#22)
must stay green.

## Today (verified in code, main@f001c91e)

- `app/[lang]/dashboard/[clientId]/studio/page.tsx`: `requireAuth` → global flag
  `conversation_studio` → `clients.id = clientId and account_id = profile.account_id`, else 404.
  No plan gate on basic Studio. Every brand **in the user's own account** already has Studio.
- `StudioShell` sidebar: brand switcher, New thread, nav (Home, Documents, Connections, Tools),
  **Recent threads capped at 4**, back-to-dashboard. Evidence inspector in the page body.
- `081`: `studio_threads` / `studio_thread_turns` carry `foreign key (profile_id, account_id)
  references profiles(id, account_id)`. Turns already record `task in ('brief','competitors',
  'pulse','report','opportunity','improve')` — the natural seed for skills.

## Part A — cross-account staff access (needs Q1 before any build)

The tenancy model makes this a real design decision, not a toggle:

- A profile belongs to exactly one account and **never moves** (composite FKs `041`–`046`).
- Studio threads FK `(profile_id, account_id)` to `profiles`, so a Fimmick-account profile
  **cannot own a thread inside a client account** as the schema stands.
- Inviting staff into the client account is impossible for an existing Fimmick profile
  (one profile, one account; an invite only diverts a *new* sign-up).

Options:

| | Model | Schema | Threads | Risk |
|---|---|---|---|---|
| **A1** | Platform admin "open as staff": `profiles.is_admin` (one writer: `npm run grant-admin`) may open any brand's Studio | none | **temporary only** (not saved), evidence read-only | Low; reuses the one audited admin grant; but no saved staff work |
| **A2** (recommended end state) | **Delegated access grant**: a client account grants a named staff profile access to its brands; revocable, expiring, audited | new migration: `studio_access_grants` (client account, grantee profile, granted_by, expires_at, revoked_at) + `studio_staff_threads` keyed by grant, or a nullable `grant_id` lineage on threads | saved, attributed to the staff member, visible to the client | Medium; must enter `tenancy-inventory.test.ts`, every read filters by `account_id` **and** a live grant |
| A3 | Move/duplicate staff into client accounts | — | — | Rejected: violates "a profile's account_id is never moved" |

Non-negotiables for A1/A2: no cross-account read without the grant (404 otherwise, 503 on a
failed lookup — the `localTrust/guard.ts` shape); every staff open writes an audit row; the
client account can see who has access; revocation takes effect on the next request.

## Part B — layout redesign (no schema in R1)

Target information architecture (to be matched against the reference screenshots):

```
┌ Sidebar ───────────────┬ Thread ─────────────────────────────┬ Evidence (collapsible) ┐
│ Brand switcher (space) │ Breadcrumb: Brand / Skill / Thread   │ Pulse · Search Console │
│ [+ New thread]         │ Messages (reply cards, citations,    │ DataForSEO · Firecrawl │
│ Skills                 │   Save to Google Docs, site edit)    │ Documents · Attached   │
│  · FAQ / schema        │                                      │                        │
│  · Content brief       │                                      │                        │
│  · Competitor gap      │                                      │                        │
│  · AI visibility (Pulse)│                                     │                        │
│  · Report              │ Composer: skill chip · attach · send │                        │
│  · Improve / fix       │                                      │                        │
│ Threads  [search]      │                                      │                        │
│  Today / This week /   │                                      │                        │
│  Older (skill tag)     │                                      │                        │
└────────────────────────┴──────────────────────────────────────┴────────────────────────┘
```

- **Skills catalogue** in code (`lib/conversation-studio/skills.ts`): id, `messages` keys, starter
  prompt, allowed evidence, output format, mapped to the existing `task` values (no new task
  vocabulary in R1). Skill pages are entry points; a thread opened from one keeps its tag.
- **Threads**: full list (paginated, existing private-thread reads), client-side search over
  titles, grouped by date; skill tag derived from the first turn's `task` (no migration in R1).
- **Evidence** moves to a right panel, collapsed by default on narrow screens; mobile uses a
  drawer for the sidebar and a sheet for evidence.
- Keep: design tokens (`neutral-*`, `tone-*`), `MotionRoot` rules, zh-HK line rules, honesty copy
  (待核實／未有／未連接／未啟用), "let the layout do the explaining" (no secondary descriptions
  under every control), ⌘K palette, both locales.

## Slices

| Slice | Scope | Schema | Gate |
|---|---|---|---|
| **R1** | New shell after the reference: sidebar (brand-as-space switcher, New thread, nav Overview / Threads / Weekly report / Connections, recent threads with relative time, full searchable thread list), New-thread screen with skill cards, conversation view with conclusion-first reply and an honest evidence trace, evidence panel | none | existing `conversation_studio` flag; e2e + axe in both locales |
| **R1b** | Overview snapshot cards from saved data (no model call) and Weekly report view over the existing rollup and approval chain | none | — |
| **R2** | Skill-scoped composer and output formats; skill tag on thread list | none (or `087 studio_threads.skill` if derivation is not enough — applied **before** merge, the schema gate now enforces it) | — |
| **R3** | Cross-account staff access (A1 or A2 per Q1) | A2: new migration + tenancy inventory | named Approve for the migration |

## Open questions

1. **Q1 — cross-account model:** A1 (admin, temporary threads, no schema) first, A2 (delegated
   grants, saved staff threads) later, or straight to A2?
2. **Q2 — who is "staff":** existing platform admins only (`is_admin`), or a new Fimmick staff role?
3. **Q3 — reference:** 2–4 screenshots of ads-copilot (sidebar with skills, a thread, the skill
   picker/new-thread state), or add `ads-copilot-alpha.vercel.app` to this environment's allowed
   network domains so it can be studied directly.
4. **Q4 — skill list:** confirm the six above (FAQ/schema, content brief, competitor gap, AI
   visibility, report, improve) or name others.
5. **Q5 — rollout:** replace the current layout in place behind the existing flag (recommended),
   or ship side by side behind a new flag (needs a flag decision; Claude Code never flips flags).
