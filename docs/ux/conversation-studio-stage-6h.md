# Conversation Studio Stage 6h — Hong Kong content opportunities READ

**Base:** `7bb2a105d95ad6457da8bd480ee7ba792f5b1a8d` (`origin/main`)
**Branch:** `codex/conversation-studio-stage-6h`
**Spec:** [`_fleet_docs/2026-11-01-aiso-studio-prod-6g-6h-design.md`](../../_fleet_docs/2026-11-01-aiso-studio-prod-6g-6h-design.md)
§4 **6h**; implementation brief [`_fleet_docs/BRIEF.md`](../../_fleet_docs/BRIEF.md)
**Copy:** Hazel pack [`_fleet_docs/2026-11-01-aiso-studio-6g-6h-string-pack.md`](../../_fleet_docs/2026-11-01-aiso-studio-6g-6h-string-pack.md)

> The `_fleet_docs` paths are task references only. They are intentionally untracked and are not part of the committed change.

## Outcome

Studio's「找出香港內容機會」template is now a read of the existing, ownership-checked
`lib/opportunities` service. Submitting the template renders real saved suggestion titles,
actions and evidence references for the current brand instead of falling through to B1 brief
extracts.

The result keeps the existing KD1 I5「前往內容機會」/ “Open content opportunities” outbound link
to the current brand's `/opportunities` route. The link is still built from `clientId` and the
localized dashboard navigation; there is no cross-brand fallback.

## Server read and tenancy

- `app/[lang]/dashboard/[clientId]/studio/page.tsx` establishes brand ownership before loading
  Studio data.
- `lib/conversation-studio/opportunities.ts` calls `loadAuthenticatedOpportunities(clientId)`,
  which resolves the session profile, validates the client UUID, executes the store's
  `clients.id + account_id` ownership check and reads only owned Pulse/scan evidence.
- `CLIENT_NOT_FOUND` and `UNAUTHENTICATED` fail closed to `null`; the page then returns
  `notFound()`. A foreign `clientId` therefore cannot produce Studio opportunity rows.
- `OPPORTUNITIES_UNAVAILABLE`, incomplete source reads and no available suggestions produce an
  explicit pending/empty state. They never produce demo rows.

The server-to-client projection contains only display-safe fields: localized title, action,
record date and source references. It removes fingerprints, raw answers, scan envelopes,
candidate-save snapshots and saved-draft mappings.

## Result and honesty states

| Read state | Result |
|---|---|
| Owned suggestions | Real titles/actions plus Pulse/scan evidence refs |
| Empty completed reads | `None yet for this brand.` /「此品牌暫時未有內容機會。」 |
| Partial, unavailable or failed read | `Pending verification — opportunities could not be loaded for this brand.` /「待核實：暫時無法載入此品牌的內容機會。」 |
| Partial read with suggestions | Real available suggestions plus a limited-evidence note |

“Search demand: pending verification” remains visible. The template explicitly says no ranks or
volumes are inferred. Missing evidence is not presented as zero demand.

## Tests and checks

- `__tests__/conversation-studio/opportunities.test.ts` covers owned suggestion projection,
  localized copy, empty/partial/unavailable states, fail-closed ownership/authentication and no
  outbound fetch.
- `__tests__/conversation-studio/reply.test.ts` covers the opportunity result using only the
  preloaded read model and explicit empty/pending replies.
- `__tests__/components/conversation-studio.test.tsx` covers real titles/evidence refs, empty
  honesty and the same-brand I5 outbound link in EN and zh-HK.
- `__tests__/conversation-studio-page.test.tsx` covers server wiring and ownership failure.
- `tests/e2e/conversation-studio.spec.ts` covers saved, empty and pending opportunity results
  with zero browser network requests.

Run the focused checks with:

```bash
npm run test:unit -- \
  __tests__/conversation-studio/opportunities.test.ts \
  __tests__/conversation-studio/reply.test.ts \
  __tests__/conversation-studio-page.test.tsx \
  __tests__/components/conversation-studio.test.tsx \
  __tests__/conversation-studio/guardrails.test.ts --maxWorkers=2
npm run typecheck
npm run lint
```

## NO_GO boundaries

This slice performs no Production/Preview environment change and does not enable
`FEATURE_CONVERSATION_STUDIO`, `FEATURE_CONVERSATION_STUDIO_LIVE` or any equivalent. It adds no
durable quota, migration, work-item save, thread persistence, source attachment or vendor call.
It does not query DataForSEO, Firecrawl, GSC or OpenRouter for this result, does not fabricate a
Mentions HK score, search volume or opportunity rank, and does not redesign the existing
`/opportunities` workspace.

Merge, promotion and the separate Production FEATURE/LIVE Approves are outside this coding PR.
`vercel.json` disables Git deployment only for the exact `codex/conversation-studio-stage-6h`
branch and preserves every existing entry.
