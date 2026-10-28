# Conversation Studio Stage A

Stage A's original scope is recorded below. [Stage B1](conversation-studio-stage-b.md)
replaces its fixed reply with bounded saved-evidence summaries; it adds no live
provider calls or thread persistence.

Stage A is a brand-scoped, temporary conversation demo. It adds templates,
a composer and a thread list with a fixed demo reply. No analysis runs.

## Flag and navigation

`conversation_studio` uses the existing server flag mechanism in `lib/flags.ts`:
only `FEATURE_CONVERSATION_STUDIO=1` enables it. Unset, `0`, `true` and every
other value leave it off. The dashboard layout passes the server value to the
sidebar and top bar, including breadcrumbs and the command palette.

The sole new route is `/{lang}/dashboard/{clientId}/studio`, for `en` and
`zh-HK`. With the flag off, an authenticated direct visit redirects to the
brand's `?step=home`. With it on, the page checks the session account's brand
ownership before rendering. No entry appears at portfolio/account level.
`?step=home` continues to render WorkspaceHome; all existing tool URLs remain.

The branch `codex/conversation-studio-stage-a` has Vercel Git deployment disabled
in `vercel.json`. This PR does not deploy or change environment variables.
The env key may be enabled on an independently approved Preview for a demo;
Production remains off. Remove the Preview override after reviewing it.

## Demo behavior and boundaries

- Templates populate the draft; the explicit Send button displays a fixed reply.
  Enter inserts a newline, including during IME composition.
- Threads and drafts live only in component state. Switching between temporary
  threads preserves their drafts. Reloading, leaving the page, or changing brands
  clears the demo. There is no local/session storage or database persistence.
- Private-by-default copy describes the intended direction and explicitly says
  that saved conversations, sharing and private access controls come later.
- No market/language selector is added, so this shell makes no data coverage claim.
- No new endpoint, migration, AI/model/OpenRouter call, MCP, GSC, DataForSEO,
  Firecrawl, paid analysis, cron, Content Opportunity vertical, work-item save,
  real private-thread ACL/RBAC, billing/admin tool surface, or onboarding change.
  Stages B, C and D remain out of scope. This PR must not be merged by the agent.

## Verification

Unit tests exercise exact-value flag behavior, server flag forwarding, rendered
sidebar visibility, shared navigation/location, unchanged legacy links, explicit
WorkspaceHome routing in both flag states, and the owned page boundary. SQL and
Auth are mocked at their external boundaries; these are not live tenancy tests.

`tests/e2e/conversation-studio.spec.ts` mounts the real production component in
an offline fixture with the real locale catalogues and production CSS. It checks
templates, submit, whitespace, IME, thread switching, reload reset, no outbound
requests, responsive layout and axe accessibility. The existing component fixture
preparer includes it, so the hosted E2E matrix runs the same cases. This proves
presentation and local interactions, not hosted authentication or Preview runtime.

For an approved Preview: enable the flag, open an owned brand, choose Start work /
開始工作, submit a template and confirm the demo reply. Visit Overview and existing
tool links; verify the studio breadcrumb and command palette entry. Disable the
flag and confirm that the entry disappears and the direct URL redirects home.
No Preview deployment is created by this PR branch.

## Source limits

The restart starts at main `7302a426dfc1eb88d9bc912fadd878a1ce067ec9` (#115).
The full restart and Stage A briefs were supplied in the task. Their referenced
`/workspace/aiso-stage-a-restart/` and `/workspace/aiso-brief-conversation-studio-stage-a.md`
were absent in this cloud environment. Grok Master t56u was not accessible, and
the prototype URL returned HTTP 403. Per the brief's fallback, the implementation
uses the smallest shell meeting acceptance, with three illustrative prompt
templates rather than claiming verified prototype fidelity. Design commit
`756a406d` may be local-only and is not assumed available on the remote.
