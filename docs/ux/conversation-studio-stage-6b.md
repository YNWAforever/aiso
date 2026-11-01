# Conversation Studio Stage 6b — save as a work-item draft

**Brief:** `/workspace/aiso-brief-stage-6b-work-item-draft.md` (authoritative)
**Design:** `/workspace/docs/superpowers/specs/2026-11-01-aiso-studio-stage-6-full-design.md`
§4, Wave 2 / 6b
**Base:** `4139f2cc257e3f70b91298a718f23f1f9ffe834c` (`origin/main`, Stage 6a tip)
**Branch:** `codex/conversation-studio-stage-6b` — draft PR only
**ClickUp:** [z8qgvca4pg](https://app.clickup.com/t/z8qgvca4pg) (Vera). **GM:** continuous-plan t335u.

## Outcome

A Studio opportunity card can now create a **real** `evidence_work_items` draft through the
existing `POST /api/clients/{clientId}/work-items` route. Success links to the existing
`/{lang}/dashboard/{clientId}/work-items/{id}/versions` review flow and the draft appears under
Studio「文件與成果」on the next read via `listAuthenticatedDrafts`. There is no parallel Studio
draft store, no browser-authored title/action, and no freeform create from LIVE prose or composer
text.

The save control appears only when all of the following are true:

- the reply is an opportunity result with loaded suggestions;
- the page has an owned `clientId`;
- the suggestion's `saveAvailability` is `available`;
- the suggestion has not already been saved.

Limited-evidence suggestions show explicit honesty instead of a save control. Already-saved
suggestions show「已保存為工作項目草稿」and open the existing draft instead of creating another.

## Create contract

`lib/conversation-studio/opportunities.ts` now forwards only the fields needed to POST, not full
evidence envelopes or raw answers:

- `source` — `pulse-metric` (`kind` + `id`) or `scan-check` (`kind` + `id` + `checkKey`);
  `agent-recommendation` remains filtered out;
- `ruleVersion` — `pulse-brand-absent.v1` or `scan-check-gap.v1`;
- `fingerprint` — the existing 64-hex evidence-version token;
- `savedDraftId`, `savedState`, `saveAvailability` — forwarded for honesty and idempotent re-save.

`StudioReplyView` posts exactly:

```json
{ "source": { "kind": "pulse-metric", "id": "…" }, "ruleVersion": "pulse-brand-absent.v1", "fingerprint": "…", "locale": "en" }
```

This is the same body shape as `OpportunityWorkspace.save`, parsed by
`lib/work-items/schema.ts#parseCreateDraft`. `locale` comes from `useLocale()` and is normalized
to `en` or `zh-HK`. The server re-validates session, tenancy, client ownership, fingerprint and
evidence currency before `createDraftIfEvidenceCurrent` writes `status='draft'`.

## Failure honesty

| API result | UI |
|---|---|
| `401 UNAUTHENTICATED` | Sign in again to save this draft |
| `404 CLIENT_NOT_FOUND` | This brand or suggestion is no longer available |
| `400 INVALID_WORK_ITEM_INPUT` | This suggestion cannot be saved as a draft |
| `409 EVIDENCE_CHANGED` | Evidence changed; refresh opportunities before saving (save disabled) |
| `503 WORK_ITEMS_UNAVAILABLE` | Work-item drafts are temporarily unavailable |
| Network / malformed success | Generic save failure; no fake saved id |

No success badge or versions link is shown unless the response carries a draft `item.id` whose
`clientId` matches the current brand. A failed save never fabricates a work-item id.

## Review semantics

Saving writes a draft only. It does not call decision, delivery, export, publish or attestation.
Approval and publishing stay in the existing work-item flow. The card says the draft is for
review so the save action is not mistaken for a published deliverable.

`templates.improve.limit` is unchanged: the improve path still has no real fingerprint-backed
create in this stage.

## Acceptance checklist (design §4 6b)

- [x]「保存為工作項目草稿」calls the existing work-items create/draft API with ownership checks.
- [x] Success links/opens the existing work-item versions flow; failure is honest with no fake id.
- [x] Does not auto-publish or skip review semantics already required by work-items.
- [x] Docs + focused tests; draft PR until merge Ask.

## Tests and checks

- `__tests__/conversation-studio/opportunities.test.ts` — create fields forwarded, scan contract,
  limited-evidence, agent-recommendation filtered, no evidence envelopes or raw answers.
- `__tests__/conversation-studio/work-item-draft.test.ts` — POST body matches
  `parseCreateDraft`, locale normalization, owning-client response validation, error mapping.
- `__tests__/components/conversation-studio.test.tsx` — saveable vs limited vs already-saved
  controls, scoped/unscoped rendering.
- `tests/e2e/conversation-studio.spec.ts` — clicking save sends the exact body and links to the
  returned draft's versions path with zero unrelated browser requests.
- Existing Stage 6a attach, LIVE quota, 6h opportunities READ and work-items suites remain green.

```bash
npm run test:unit -- \
  __tests__/conversation-studio/opportunities.test.ts \
  __tests__/conversation-studio/work-item-draft.test.ts \
  __tests__/components/conversation-studio.test.tsx --maxWorkers=2
npm run typecheck
npm run lint
```

## NO_GO / explicitly not in this PR

- No Production/Preview env writes; no `FEATURE_CONVERSATION_STUDIO*` or `_LIVE` toggle change;
  no `STUDIO_LIVE_ANSWERS_PER_WEEK` change.
- No freeform draft from LIVE model prose, composer text or the concept brief mock.
- No `agent-recommendation` create path, parallel Studio draft table or new ORM.
- No multi-source `/work-items/groups` save or `work_item_sources` redesign.
- No auto decision, delivery, export or publish.
- No Stage 6c/d/e/f work, thread persistence, new vendors, CloudAgent or agent merge.
- No Layout A/default-home flip, demo Harbour drafts or invented ClickUp ids.

The existing Prod `FEATURE_CONVERSATION_STUDIO=1` does **not** authorize LIVE/cap/env changes
here. Those remain separate GM Approves. `vercel.json` disables Git deployment only for the exact
`codex/conversation-studio-stage-6b` branch and preserves every existing entry.
