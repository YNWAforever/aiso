# AISO brief — post–Stage 6: operator honesty rename (vendor opacity)

> **For the coding agent:** read `CLAUDE.md` → `AGENTS.md` → `ARCHITECTURE.md` →
> `docs/development.md`, then this brief. Re-verify §1 before branching; it goes stale.
> Draft PR only. Never merge.

| | |
| --- | --- |
| ClickUp | [z8qgvcahq4](https://app.clickup.com/t/z8qgvcahq4) (first in the post–Stage 6 sequence; then Drive/Docs MCP z8qgvcahq5, then site-edit z8qgvcahq6) |
| Base | `main@8dd3a21e447699bdd79fa236509f0c91b481f5b8` — Stage 6f (#139) |
| Design (LOCKED) | `/workspace/docs/superpowers/specs/2026-11-02-aiso-post-stage6-plan-packaged-vs-operator-mcp-design.md` — Willy answering Luna **t223s832** (direction t221u) |
| Precondition | 6e (#137) and 6f (#139) merged ✅ — the design says the rename comes "after 6e/6f Ready" |
| Lane | **待確認** — Willy names fleet (`codex/…`) or Claude Code (`claude/…`). Only one lane builds this. |
| Assembled | 2026-11-02 from `main@8dd3a21e` and the dev pack §D3. This file is not the design; where they differ, the design wins. |

## 0. Cited lock (quote, don't paraphrase)

From the LOCKED post–Stage 6 design (t223s832), as carried in the dev pack §D3:

- «Operators must **not** see or buy DataForSEO / Firecrawl.»
- «Those APIs stay **internal** to AISO backend.»
- «**Tokens／quota are pre-packaged in the commercial plan** (plan caps), not customer-owned vendor accounts.»
- Honesty rename: «operator UI → plan-generic: DataForSEO → 「關鍵字／搜尋結果（計劃內）／未有／待核實」; Firecrawl → 「公開頁擷取／頁面內容（計劃內）／未有／待核實」; vendor pricing/top-up CTAs → plan quota remaining / over-cap stop. Ops/eng/admin docs may keep vendor names.»
- Non-goals: «inventing vendor $; customer MCP for SERP/scrape; Prod LIVE/cap/FEATURE/Neon flips; unbounded "change any website"; SME/Kinnso work.»

UI rule (AGENTS.md, t342s1437): «Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.»

## 1. State to verify before branching

```bash
git fetch origin && git log -1 --format='%H %s' origin/main   # expect 8dd3a21e… or newer
git ls-remote origin 'refs/heads/*honesty*' 'refs/heads/*rename*' # expect none
```

Also confirm there are 0 open PRs touching `messages/*.json` `conversationStudio.*`. If main moved, read the new commits first and note them in the PR.

## 2. Outcome

An operator using Conversation Studio never sees the names **DataForSEO** or **Firecrawl**, a vendor location/language code, "vendor payment", or "Preview credentials/key". They see plan-generic evidence names — **搜尋結果（計劃內）** and **公開頁擷取（計劃內）** — with the same honesty statuses as today (未有／待核實／未連接／未啟用／本週額滿／無效網址). Quota shows as **plan allowance remaining** and **over-cap stop**, never as a vendor bill.

Behaviour does not change: the same calls, the same caps (DataForSEO 1/turn + 20/week/brand; Firecrawl 1 URL/turn), the same gates, the same snapshots. This is a copy change plus one small rendering change (§4.3).

## 3. Scope — operator-visible strings to change

Inventory taken from `messages/en.json` and `messages/zh-HK.json` at `8dd3a21e`. **Proposed copy is a draft for Hazel/Iris to polish.** The contract is the rule in each row's last column, not the exact wording.

### 3.1 Evidence names (inspector headings + connections card headings)

| Key | Now (en / zh) | Proposed (en / zh) | Rule |
| --- | --- | --- | --- |
| `conversationStudio.evidence.dataForSeo` | DataForSEO / DataForSEO | Search results (in plan) / 搜尋結果（計劃內） | Locked label |
| `conversationStudio.evidence.firecrawl` | Firecrawl / Firecrawl | Public page fetch (in plan) / 公開頁擷取（計劃內） | Locked label |

### 3.2 DataForSEO turn snapshot — `conversationStudio.dfs.*`

| Key | Now (en) | Proposed (en / zh) | Rule |
| --- | --- | --- | --- |
| `title` | DataForSEO · Google Organic SERP | Search results · Google organic / 搜尋結果 · Google 自然搜尋 | No vendor |
| `pending` | Checking DataForSEO for this turn… | Checking search results for this turn… / 正在查詢本次搜尋結果… | No vendor |
| `failed` | DataForSEO could not be checked this turn. | Search results could not be checked this turn. / 本次未能查詢搜尋結果。 | No vendor |
| `weeklyCap` | Weekly calls left for this brand: {remaining} of {cap} (Hong Kong week). | Searches left in your plan for this brand this week: {remaining} of {cap} (Hong Kong week). / 此品牌本週計劃內剩餘查詢：{remaining}／{cap}（香港週）。 | Plan allowance remaining |
| `capped` | This brand’s weekly DataForSEO cap is used up. No vendor call ran. | This brand’s weekly search allowance in your plan is used up. Nothing was checked. / 此品牌本週計劃內的查詢額度已用完，本次未有查詢。 | Over-cap stop, no vendor |
| `researchStep` | Checked DataForSEO Google Organic SERP for “{keyword}” (depth 10, Hong Kong week). | Checked Google organic results for “{keyword}” (top 10, Hong Kong week). / 已查詢 Google 自然搜尋結果：「{keyword}」（前 10 名，香港週）。 | No vendor; "depth" → "top 10" |
| `location` / `language` | Location {code} / Language {language} | **Replace** with one string `market`: Hong Kong · Traditional Chinese / 香港 · 繁中 | Vendor codes (`2344`, `zh-TW`) are internal; see §4.3 |
| `status.payment` | Vendor payment required | Unavailable right now / 暫時無法使用 | Never imply the operator owes a vendor |
| `status.rate_limit` | Vendor rate limit reached | Too many requests. Try again shortly. / 請求過多，請稍後再試。 | No vendor |
| `status.*` (others) | — | unchanged unless they name a vendor | Keep 未有／待核實／未連接／未啟用／本週額滿 |
| `empty`, `keywordTooLong`, `keyword`, `items`, `rank` | — | unchanged | No vendor today |

### 3.3 Firecrawl turn snapshot — `conversationStudio.firecrawl.*`

| Key | Now (en) | Proposed (en / zh) | Rule |
| --- | --- | --- | --- |
| `title` | Firecrawl · Public page | Public page · page content / 公開頁擷取 · 頁面內容 | Locked label |
| `pending` / `failed` | (no vendor name) | unchanged | — |
| `researchStep` | Fetched one public page with Firecrawl: {url} | Fetched one public page: {url} / 已擷取一個公開頁面：{url} | No vendor |
| `status.payment` | Vendor payment required | Unavailable right now / 暫時無法使用 | As 3.2 |
| `status.rate_limit` | Vendor rate limit reached | Too many requests. Try again shortly. / 請求過多，請稍後再試。 | As 3.2 |
| `notes.*`, other `status.*` | (no vendor name) | unchanged | — |

There is no Firecrawl weekly cap, so there is no plan-allowance line for it. **Do not add one** (no weekly counter was approved; t389s1728).

### 3.4 Connections card — `conversationStudio.connections.*`

| Key | Now (en) | Proposed (en / zh) | Rule |
| --- | --- | --- | --- |
| `dfsSettingsNote` | Off by default. At most one Live Google Organic SERP call per turn and 20 per brand per Hong Kong week. | Off by default. In your plan: at most one search per turn and 20 per brand per Hong Kong week. / 預設關閉。計劃內：每回合最多查詢一次，每個品牌每個香港週最多 20 次。 | Plan cap, no vendor product name |
| `dfsSerpPending` | Hong Kong / Traditional Chinese SERP support pending verification | Hong Kong / Traditional Chinese results pending verification / 香港／繁中搜尋結果待核實 | Keep 待核實 |
| `dfsCredentialsMissing` | Preview credentials are not configured | **Remove the line**; the card shows the 未連接 status badge instead | Operators own no vendor credentials; UI rule |
| `firecrawlKeyMissing` | Preview key is not configured | **Remove the line**, as above | As above |
| `dfsSettingsSaved` / `firecrawlSettingsSaved` | DataForSEO setting saved. / Firecrawl setting saved. | Setting saved. / 已儲存設定。 | No vendor |
| `firecrawlSettingsNote` | (no vendor name) | unchanged | — |
| `hkEndpointPending`, `disconnected`, `firecrawlScope` | — | check the fallback cards still read correctly under the new headings; change only if they name a vendor | — |

### 3.5 Scope and honesty sentences

| Key | Change | Rule |
| --- | --- | --- |
| `conversationStudio.evidence.liveLimit` | Replace "Firecrawl" and "DataForSEO ChatGPT LLM Mentions" with the plan-generic names; keep every honesty clause (Search Console HK + PT dates, one public page only when the turn has its URL, US/EN coverage ≠ HK, missing ≠ zero) | Same meaning, no vendor |
| `conversationStudio.live.savedScope` | Same treatment | Same meaning, no vendor |
| `conversationStudio.honesty.mentionsCoverage` | "HK / Traditional Chinese: ChatGPT mention coverage is currently US / English only. No Hong Kong ChatGPT score is shown here." / 「HK／繁中：ChatGPT 提及覆蓋目前只限美國／英文，此處不顯示香港 ChatGPT 分數。」 | **Keep the US/EN-only honesty**; only the vendor name goes. Never show an HK Mentions score. |

## 4. Implementation

### 4.1 Approach

- **Copy-first.** Change values in `messages/en.json` and `messages/zh-HK.json`. **Keep the message key paths** (`dfs.*`, `firecrawl.*`, `connections.dfs*`, `evidence.dataForSeo`). Key paths are not operator-visible; renaming them touches every component and test for no user benefit. If Willy wants the keys renamed too, do it as a separate follow-up.
- Code identifiers, routes (`/studio/dataforseo`, `/studio/firecrawl`), env names, DB tables and migration files **stay as they are**. Ops/eng docs keep vendor names (allowed by the lock).

### 4.2 Files

| Path | Change |
| --- | --- |
| `messages/en.json`, `messages/zh-HK.json` | §3 values; add `dfs.market`; delete `dfs.location`, `dfs.language`, `connections.dfsCredentialsMissing`, `connections.firecrawlKeyMissing` |
| `components/dashboard/StudioDfsSnapshot.tsx` | Render `t('market')` + the existing 待核實 badge instead of the location/language codes (§4.3) |
| `components/dashboard/StudioSecondaryViews.tsx` | `DfsSettings` / `FirecrawlSettings`: replace the missing-key note with the existing 未連接 badge when the key is not configured; no new copy |
| `docs/ux/conversation-studio-concept/STRINGS.md` | New "Post–Stage 6 honesty rename" section: old → new per key. Mark the 6e/6f sections as superseded for operator copy. |
| `docs/ux/conversation-studio-stage-6e.md`, `…-6f.md` | One line each: operator copy renamed in this PR; vendor names remain in ops docs |
| `docs/ux/conversation-studio-honesty-rename.md` | **New**: cite the lock, list renamed keys, the guard test, and NO_GOs |
| `vercel.json` | Append only this PR's branch as `false` (25 → 26 keys) |
| Tests | §5 |

### 4.3 The one rendering change

`StudioDfsSnapshot` prints `Location 2344 · Language zh-TW`. Those are DataForSEO's internal codes, so showing them leaks the vendor. Replace them with `t('market')` ("Hong Kong · Traditional Chinese" / 「香港 · 繁中」), keeping the amber 待核實 badge. The snapshot type keeps `locationCode` / `languageCode` (server-side contract). Only the rendering stops printing them.

## 5. Tests (AC)

- **AC-1 vendor-name guard (new, in `__tests__/conversation-studio/guardrails.test.ts`):** walk every string under `conversationStudio` in both locales and fail on `/DataForSEO|Firecrawl/i`. Within `dfs.*`, `firecrawl.*` and `connections.dfs*` / `connections.firecrawl*`, also fail on `/vendor|供應商|Preview|憑證|金鑰|credential/i`. Do **not** ban 「供應商」 elsewhere in `conversationStudio.evidence.*` / `live.*`: there it means the AI answer providers (model citations), which is a different, unchanged meaning.
- **AC-2 honesty preserved:** the new `mentionsCoverage` still contains US/English-only wording in both locales (assert on `美國／英文` and `US / English`), and the liveLimit / savedScope strings still contain the missing-≠-zero clause.
- **AC-3 snapshot rendering:** `StudioDfsSnapshotView` renders `market` + 待核實 and **not** `2344` or `zh-TW`; the research steps for ok/empty turns contain no vendor name (both locales).
- **AC-4 connections card:** with the key not configured, the card shows 未連接 and no "Preview…" line; with the key present, it shows the switch as today.
- **AC-5 e2e:** extend `tests/e2e/conversation-studio.spec.ts` (currently asserts saved research steps exclude `/DataForSEO|Firecrawl|GSC|OpenRouter/`) so the inspector and connections view also exclude `/DataForSEO|Firecrawl/`.
- Update existing assertions in `__tests__/components/conversation-studio.test.tsx` that read the changed keys (most read keys, not literals; the `location`/`language` and `*CredentialsMissing` / `*KeyMissing` assertions must change).
- Full gate: `npm run typecheck`, `npm run lint` (0/0), `CI=1 npm run test:unit -- --maxWorkers=4`, `npm run build`. No migration, so no RLS inventory change.

## 6. Out of scope

- Behaviour, caps, gates, routes, snapshots, env, DB — **no change**.
- AI model provider wording (「供應商」 for ChatGPT/Gemini answer providers, observations, citations) and the OpenRouter disclosure in `brandAssistant.disclosure` — a separate privacy/provenance surface, not covered by the lock.
- Pricing page, plan names, `PlanFeatures` keys, SKU naming for packaged caps (an open question in the design — do not invent plan names).
- Drive/Docs MCP (z8qgvcahq5), site-edit (z8qgvcahq6).
- Any customer-facing "connect/buy vendor" flow — there must be none.

## 7. Open questions（待確認 — ask Willy; don't invent）

1. **Lane:** fleet or Claude Code?
2. **Admin/eng visibility:** the design leaves open «whether Preview may keep eng-facing vendor strings behind an admin flag». Default in this brief: **no** flag (no new `FEATURE_*`); vendor names stay in ops docs only. Confirm.
3. **Key paths:** keep `dfs.*` / `firecrawl.*` key names (this brief's default) or rename them to plan-generic keys in the same PR?
4. **「（計劃內）」 everywhere?** The lock gives the label; confirm it appears on the inspector and connections headings only (default), not on every status line.
5. **`status.payment` copy:** 暫時無法使用 (default), or a distinct "service setup issue" wording for ops triage?
6. **"SERP" as a word:** keep it in operator copy, or treat it as jargon and replace it with 搜尋結果 everywhere (default: replace where touched; not added to the guard)?

## 8. HOLD / NO_GO

- Prod/Preview LIVE, `STUDIO_LIVE_ANSWERS_PER_WEEK`, any `FEATURE_*`, any Vercel env.
- Hosted Neon migrate of 081 / 082 / 083 (still not applied).
- New nav or pages, vendor-buy CTAs, invented `$` / credit counts / plan names.
- Any change to DataForSEO/Firecrawl call semantics or caps.
- Merge, undraft, force-push shared branches.

## 9. PR

- Title: `feat(studio): plan-generic evidence names, no vendor names in operator UI (post–Stage 6 honesty rename)`
- Draft PR body: base SHA, files, the old→new key table (or a link to the STRINGS.md section), tests, "no migration", NO_GO list, cites **t223s832** + t342s1437.
- Ready packet for Willy (→ Grok Master merge Ask): PR URL, 40-char tip, base, CI run + status, vercel count before/after, deviations, answers to §7.
