# Conversation Studio default home — brand dashboard lands in Studio

**Base:** `61b78ebdf0cabf543ed69d2858c2ee667573491e` (`origin/main`, #130)
**Branch:** `codex/conversation-studio-default-home`
**Brief:** [`_fleet_docs/BRIEF.md`](../../_fleet_docs/BRIEF.md) (untracked task reference,
not part of this change)
**Design amendment:** `_fleet_docs/stage-6-full-design.md`
§「Amendment — Prod default-home → Studio (asap)」, 2026-11-01 ~22:54 HKT
**Trigger:** Willy, AISO room「fix that asap」after Production FEATURE ON.
**FEATURE ON cite:** GM **t361s1554** — `FEATURE_CONVERSATION_STUDIO=1`, deploy tip
`61b78ebd`. This change does **not** flip FEATURE, LIVE, the weekly cap or any environment.

## Outcome

When `isFeatureEnabled('conversation_studio')` is true, a brand dashboard entry URL with
no step (or `?step=home`) redirects on the server to
`/{lang}/dashboard/{clientId}/studio`. Everything else keeps today's routing: explicit
steps (`scan`, `results`, `improve`, `monitor`, `roi`), ownership checks and the FEATURE-off
behavior are unchanged. Studio keeps its existing honest shell when LIVE is off
(`as-note` / `featureShellNote`); no copy changed.

## Alias decision: `?step=overview`

Redirecting `home` alone would make WorkspaceHome unreachable, because Overview and Studio's
「返回 dashboard」back link both pointed at `?step=home`. The smallest consistent fix is an
explicit alias:

- `?step=overview` renders **WorkspaceHome** (same code path as `home`) and is **never**
  redirected.
- When Conversation Studio is enabled, `lib/dashboard-nav.ts` builds the Overview href as
  `?step=overview`; otherwise it stays `?step=home`.
- `STEP_LOCATION` maps `overview` to the Overview section, so breadcrumbs and
  `aria-current` keep working. No new route segment or page was added.
- Studio's back link is `?step=overview`. The Studio palette/tools also request the
  `conversationStudio` nav shape, so their Overview entry cannot bounce back into Studio.

## Entry points

| Entry point | FEATURE ON | FEATURE OFF |
|---|---|---|
| Bare brand URL `/{lang}/dashboard/{clientId}` | 307 → `/{lang}/dashboard/{clientId}/studio` | WorkspaceHome (`home`) |
| `?step=home` | 307 → `/studio` | WorkspaceHome |
| `?step=overview` | WorkspaceHome | WorkspaceHome |
| `?step=scan\|results\|improve\|monitor\|roi` | Unchanged | Unchanged |
| BrandCard (bare brand link) | Follows the page redirect → Studio | WorkspaceHome |
| TopBar brand crumb / picker / ⌘K brands | `…/{clientId}/studio` | `…/{clientId}?step=home` |
| Studio「返回 dashboard」back link | `…/{clientId}?step=overview` | Studio route redirects to `?step=home` |
| Alert email link (bare brand URL) | Studio | WorkspaceHome |
| Onboarding completion (`…/{clientId}/prompts`) | Unchanged (not a bare brand URL) | Unchanged |
| Overview sidebar item | `?step=overview` → WorkspaceHome | `?step=home` → WorkspaceHome |

`requireAuth(lang)` still runs before the redirect, so signed-out users keep today's login
redirect. Studio still validates the brand UUID and `account_id` ownership before rendering,
so a foreign or invalid `clientId` still 404s.

## Rollback

No new env var or flag was added. To restore the WorkspaceHome default while leaving
`FEATURE_CONVERSATION_STUDIO` on, set `STUDIO_DEFAULT_HOME = false` in
`lib/dashboard-nav.ts` (one line, mirroring `MONITOR_VISIBLE`), or revert this PR. The
alias and nav helper remain harmless when the redirect is off.

## Tests

- `__tests__/workspace-home-page.test.tsx` — FEATURE on redirects for bare/empty/`home`,
  `overview` renders WorkspaceHome, explicit steps never redirect, auth runs first;
  FEATURE off keeps WorkspaceHome.
- `__tests__/lib/dashboard-nav.test.ts` — conditional Overview href and `overview`
  location mapping.
- `__tests__/components/top-bar.test.tsx` — brand crumb/switcher/palette go to `/studio`
  when enabled and stay `?step=home` when disabled.
- `__tests__/conversation-studio/shell.test.tsx` — Studio tools keep the legacy href by
  default and use `?step=overview` when the Studio nav is requested.
- `__tests__/conversation-studio-page.test.tsx` — FEATURE-off Studio still redirects to
  `?step=home` (no loop).
- `tests/e2e/studio-shell.spec.ts` — back link uses `?step=overview`.
- `tests/e2e/authenticated/owner-review.spec.ts` — WorkspaceHome journeys use
  `?step=overview` instead of relying on a bare brand URL landing there.

## NO_GO boundaries

This PR does not change Production/Preview environment variables, does not enable or
disable `FEATURE_CONVERSATION_STUDIO` or `FEATURE_CONVERSATION_STUDIO_LIVE`, does not change
`STUDIO_LIVE_ANSWERS_PER_WEEK`, and does not turn LIVE ON. It adds no new env flag, route
segment, vendor or CloudAgent, no Layout B concept shell or visual redesign, and no
Stage 6a–6f work. It is not stacked on #132 (a trivial later `vercel.json` conflict is
expected; keep both keys). `vercel.json` disables Git deployment only for the exact
`codex/conversation-studio-default-home` branch and preserves every existing entry.

Draft PR only. Merge, LIVE and cap moves remain separate GM Approves. ClickUp ID:
待核實 — do not invent one.
