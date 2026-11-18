# Logged-in UX review — Studio (Chat) and workspace

Date: 2026-11-18. Method: code review of `app/[lang]/dashboard/**`, `components/dashboard/**`
and `messages/*`, plus screenshots of the CI component fixtures (Studio shell, Today,
app shell) at 1440 px and 375 px. No live production session was used: sign-in is
magic-link / Google only, so the review rendered the same production components through
`scripts/ci/prepare-component-fixtures.mjs`.

## Fixed in this change

| Area | Problem | Fix |
| --- | --- | --- |
| Top bar | ⌘K palette entries read "Improve ?? Tasks"; the shortcut hint was a broken glyph (encoding damage). | Restored `›` and `⌘K` in `shell/TopBar.tsx`. |
| Studio composer | Unticking the last AI model disabled the whole model picker — no way back without a reload — and said "AI replies are currently unavailable". | Picker stays enabled while LIVE is available; new `live.selectPlatform` message. |
| Studio | Raw model ids (`gemini-flash`, `gpt-4o`) as checkbox labels and answer headings. | Display names via `lib/brand-month/labels.ts` (`platformName`). |
| Studio | Archive had no confirmation; the archived row stayed in Discussions and the recent list until reload, and cannot be restored from the UI. | Confirm dialog (`threadActions.archiveConfirm`); archived threads filtered from both lists. |
| Studio | Thread "…" menu stayed open over the rename form after an action. | Menu closes after any action. |
| Studio | "Skills" shown twice (disclosure summary + h2). | The summary is the heading. |
| Studio | Jargon: "Search Console · Bound", "Binding status only; no search data queried", "This page does not query any provider", "Data completeness requires verification", "Weekly LIVE answers … are used". | Plain-language rewrites (en + zh-HK). |
| Members | "Remove" cut a colleague's access in one click, with no confirmation, no success notice and no accessible name per row. | Confirm, success notice, per-person `aria-label`, danger styling. |
| Scan | API error text (raw English, e.g. "Client lookup failed") shown to users in both locales. | Translated messages per status class (429 / 5xx / other). |
| Scan | Copy promised "Free for everyone — no subscription needed" above a paid-plan gate. | Sentence removed (en + zh-HK). |
| Results | Empty state said "run a scan" with no way to do so. | "Run a new scan" button. |
| Locked features | Upgrade button failed silently and could start two checkouts. | Busy state; any failure falls back to `/{lang}/pricing`. |
| Navigation (legacy IA) | `/dashboard/billing` and `/dashboard/this-month` lit "Overview" (treated as a brand id). | `locateDashboard` maps them; test added. |
| Mobile shell | A full-width "Toggle workspace navigation" text bar cost a whole row of chrome. | Icon button (same accessible name) in the logo row. |
| Mobile shell | `h-screen` hid the bottom of the scroll area behind iOS Safari's toolbar. | `h-dvh`, as Studio already used. |
| Today | Internal design copy shown to users ("One thing to do, one way to ask…"); failure states ("Could not read") rendered as large bold headline numbers. | User-facing summary; missing-data states rendered quieter than real values. |

## Fixed in the follow-up

| Area | Fix |
| --- | --- |
| Studio dates | Documents, evidence inspector and live-reply times shown as readable dates (Hong Kong time) via `lib/conversation-studio/format-date.ts`; the exact instant stays in `<time dateTime>`. The document version id is de-emphasised. |
| Overview (legacy IA) | Raw "… UTC" strings shown in Hong Kong time; the always-"unknown" "Next scheduled work" line removed. |
| Brand cards | "Freshness: unknown" only when there is no observed date. |
| Billing | Plan shown as "Pro", not "pro"; month as "November 2026", not "2026-11"; plain-language charge hint; "Try again" after a failed load. |
| Settings | One Billing section: the fix-pack/invoice link moved next to the Stripe portal link. |
| Naming | In the copilot IA the in-thread back button reads "Back to Chat" and the Studio error page heading reads "Chat". |
| Search Console | Plans or rollouts without Search Console no longer see "Search Console · Pending verification". |
| Discussion layout | The 240 px rail column is reserved only when the rail renders; while evidence is open it takes that column instead of wrapping below the conversation. |
| Headings | Scan, Results, Local visibility and the load-error state now have an `h1`. |
| Top bar | Brand switcher, avatar, help and their menu rows are 44 px; ⌘K hint hidden on touch devices. |
| Notifications | The bell's accessible name includes the unread count. |
| Today | The setup checklist marks finished steps as done (not links) and highlights the current one. |
| Honesty note | `featureShellNote` rewritten in plain language with owner sign-off: "AI replies are not switched on for this brand yet. You can still ask: answers use your latest scan, your saved weekly AI checks and any approved document you attach." The guardrail test pins the new text. |
| Mobile Studio | The top bar drops the duplicate market chip on phones; "Choose documents" no longer wraps. |

## Still open — needs an owner decision

1. **Inline links in Studio are 44 px boxes** (`#aiso-studio a` in `conversation-studio.css`),
   which breaks sentences such as "Open sources". `studio-shell.spec.ts` requires every link to
   be ≥ 44 px, so changing it is a deliberate rule change, not a bug fix.
2. Studio action panel still prints the scan record id ("Scan record: {uuid}") as its scope line;
   it is the audit reference for the run, so removing it is a product call.
