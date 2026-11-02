# Conversation Studio — post–Stage 6 honesty rename

- Brief: `docs/superpowers/plans/2026-11-02-aiso-brief-post6-honesty-rename.md`
- ClickUp: [z8qgvcahq4](https://app.clickup.com/t/z8qgvcahq4)
- Lock: Willy answering **t223s832** — «Operators must **not** see or buy DataForSEO / Firecrawl.» «Those APIs stay **internal** to AISO backend.» «**Tokens／quota are pre-packaged in the commercial plan** (plan caps), not customer-owned vendor accounts.» UI rule t342s1437.
- Decisions (Willy, 2026-11-02): Claude Code builds it; message key paths stay; no admin flag for vendor names.
- Base: `8dd3a21e447699bdd79fa236509f0c91b481f5b8` (Stage 6f #139)

## What changed

Operator copy in Conversation Studio no longer names the evidence vendors,
prints their internal location/language codes, mentions vendor payment, or asks
for Preview credentials/keys. The evidence names are **搜尋結果（計劃內）** and
**公開頁擷取（計劃內）**, on the inspector and connections headings only. The
weekly cap reads as plan allowance remaining, and an exhausted cap as an
over-cap stop. Old → new copy is in
`docs/ux/conversation-studio-concept/STRINGS.md` ("Post–Stage 6").

Behaviour is unchanged: the same calls, caps (search 1/turn + 20/week/brand;
public page 1 URL/turn), gates, routes, snapshot types, env names and tables.
The only rendering change: `StudioDfsSnapshot` shows `dfs.market` instead of the
vendor's location and language codes, and the settings cards show the existing
未連接 badge instead of a "Preview key/credentials" note.

## Kept on purpose

- 「供應商」 where it means the AI answer providers (citations, observations,
  LIVE) and the OpenRouter disclosure — a different surface, not covered by the lock.
- Vendor names in code identifiers, routes, env names, tables, migrations and
  ops/eng docs (the lock allows ops/eng docs to keep them).
- US/EN-only Mentions honesty and missing-is-not-zero wording.

## Guards

- `__tests__/conversation-studio/guardrails.test.ts` — no `DataForSEO`/`Firecrawl`
  anywhere in `conversationStudio` copy (both locales); no vendor/供應商/Preview/
  憑證/金鑰/credential wording in `dfs.*`, `firecrawl.*`, `connections.dfs*`,
  `connections.firecrawl*`; the honesty clauses remain.
- Component tests: snapshot renders the market label, never `2344`/`zh-TW`;
  connections card shows no vendor or Preview wording.
- e2e: the inspector (`conversation-studio.spec.ts`) and connections view
  (`studio-shell.spec.ts`) contain no vendor names.

## Defaults pending confirmation

- 「（計劃內）」 on headings only, not on each status line.
- `status.payment` → 暫時無法使用 (no separate "setup issue" wording).
- "SERP" removed from the copy this PR touched; not added to the guard.

## HOLD / NO_GO

No LIVE/`STUDIO_LIVE_ANSWERS_PER_WEEK`/`FEATURE_*`/env change; no hosted Neon
migrate (081/082/083 still unapplied); no new nav, vendor CTAs, invented `$`,
credit counts or plan names; no call-semantics change; no merge.
