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

## Open — recommended next

1. **Studio honesty note is pinned.** `conversationStudio.featureShellNote` ("Live model answers
   stay off until LIVE is enabled…") is jargon but asserted verbatim by
   `__tests__/conversation-studio/guardrails.test.ts`; rewording needs the owner's sign-off.
2. **Inline links in Studio are 44 px boxes** (`#aiso-studio a` in `conversation-studio.css`),
   which breaks sentences such as "Open sources". `studio-shell.spec.ts` requires every link to
   be ≥ 44 px, so changing it is a deliberate rule change, not a bug fix.
3. **Raw timestamps / ids** in Studio (`StudioSecondaryViews`, `StudioEvidenceInspector`,
   `StudioActionPanel` "Scan record: {uuid}", `StudioLiveReply` `finishReason`), Billing
   ("2026-11", raw plan id) and the legacy Overview ("… UTC", "Freshness: unknown" on every card).
4. **One place, three names**: "Start work", "Chat" and "Studio" label the same area; the
   in-thread back button and error h1 use `title` ("Start work") while the shell says "Chat".
5. **Plans without Search Console** see "Search Console · Pending verification" — needs a
   `not_entitled` state or the source bar hidden.
6. **Discussion layout** always reserves a 240 px rail column (`as-has-rail`) even when no rail renders.
7. **Settings** has two "Billing" sections; **Scan / Results / Local visibility** steps render
   their title as `<p>` (no h1); top-bar menu buttons are 36 px (`MenuButton.tsx`).
8. **Today setup checklist** lists all four steps with no done/current state.
9. **Notification bell** does not announce the unread count to screen readers.
10. Mobile Studio composer: "Choose documents" wraps to two lines and the locale chip takes its
    own row; the top bar's ⌘K hint is meaningless on touch devices.
