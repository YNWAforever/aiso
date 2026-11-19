# Phase 4: one zh-HK voice, one date format

Date: 2026-11-19. Follows `2026-11-18-phase-3-decisions.md` (PR #306). Branch
`claude/ux-phase-4`. Finishes the two follow-ups that Phase 3 left open.

## zh-HK register

PR #306 moved Studio and Today to written Chinese (書面語). This change moves the
remaining **75 colloquial strings** to it as well: Pulse, observations, change sets, run
progress, entities, the combined report, citations, competitors, and a few dashboard and
settings lines. Meaning is unchanged; no keys were added or removed.

- **Not changed:** `pricing.row_client_report` (「具備你嘅 Agency 品牌設定嘅網上客戶報告」).
  `__tests__/lib/product-facts.test.ts` pins it as approved pricing wording, so changing
  it needs the owner's sign-off. Suggested wording: 「具備你的 Agency 品牌設定的網上客戶報告」.
- Four other strings matched the colloquial search only because 因果關係 contains 係
  (`publicPages`, `outcomes`, `outcomeIntegrations`, `enterpriseOS`). They were already
  written Chinese.

## Dates

Six dashboard surfaces formatted dates in their own way:

| Surface | Before | Problem |
| --- | --- | --- |
| `ScanSummary` | `en-US`, UTC | English dates in the zh-HK UI |
| `RecentScans` (portfolio, brand cards) | `en-US`/`zh-HK`, UTC | A scan at 23:30 UTC showed the previous day for Hong Kong users |
| `ScanStep` (recent scans) | locale, UTC | same |
| `ScanPicker`, `ImproveStep` | locale, UTC, with time | Times shown in UTC without saying so |
| `NotificationBell` | `en-US`/`zh-HK`, browser zone | Server and browser could disagree |

All six now use `lib/format/date.ts` (`formatDisplayDate`): in the user's language, in
Hong Kong time, and the same string on the server and in the browser, so there is no
hydration mismatch. The portfolio note "Dates shown in UTC." now reads "Dates shown in
Hong Kong time." / 「日期以香港時間顯示。」.

**Left as they are:** the report surfaces (`CombinedReport`, `OnePageReport`,
`ReportTrend`, monthly reports) and the month labels. They already pin a zone
deliberately: UTC for calendar dates, Hong Kong time for instants. Some of them render in
the report's own language rather than the viewer's. The admin `AccountRow` is internal.

## Studio: a discussion reads as one thread

Owner report (2026-11-19): a Studio discussion did not feel like a continuous thread. In a
3-turn zh-HK fixture, every follow-up rendered as a stacked report. Each had a bordered
"evidence used" box, a card with an "AI 回覆" label *and* an "AI 回覆 · 待核實" heading, a
yellow banner, the weekly quota line (repeated on every turn and again in the composer), a
one-item bulleted platform list, a "coverage: present" chip, and a yellow saved-summary box.
The answer itself was one line inside all of that.

Now each turn reads as a chat exchange:

- The person's question is a right-aligned bubble sized to its text.
- "Used N sources" is a quiet line rather than a box. It still opens the trace.
- The reply has one header line: icon, "AI reply · unverified" heading, the model name when
  only one model answered, and the "unverified" flag as a small pill. Then come the answer
  and its actions.
- The weekly quota is shown once, in the composer. A coverage badge appears only when
  coverage is not complete. The saved-data summary is a muted disclosure.
- Honesty is unchanged. Live output keeps the unverified heading and flag, plus a 3 px amber
  left edge that sets it apart from saved evidence; `conversation-studio.spec` pins all three.
