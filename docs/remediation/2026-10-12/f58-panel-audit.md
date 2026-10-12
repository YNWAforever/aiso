# F58 — AI question suggestions: accessibility and recovery

## Evidence boundary

Audited on 2026-10-12 against main `b5d1a281349469a6dfaf0e01bda736631de4ad79` (PR89). The production alias resolved to READY deployment `dpl_9Ca4v2s73JzDN67VCbXoqws9oAxs` at that commit. PR88 and PR89 are merged. Their earlier validation remains historical evidence; it is not counted as execution of this patch.

After a full reload of the authenticated zh-HK question bank, opening **建議更多** left focus on its opener. The panel appeared as an unnamed container, its close button had no accessible name, Tab moved to the background CSV control, Escape did not dismiss it, and clicking close returned focus to the document body. This was reproduced without generating AI suggestions or writing any question. No customer data, account identity, session or secret is included here.

Source review also found that pending writes had no synchronous lock and failed saves disappeared with the panel. Because the existing POST endpoint has no idempotency receipt, a transport failure cannot prove that a write did not commit.

## Implemented behavior

- A named native modal dialog contains keyboard focus and makes background controls inert. Opening focuses the named close button; Escape/close restores the opener. Scrollable content, theme tokens, translated labels and minimum 44px actions support desktop and mobile use.
- Generation starts only after an explicit click. It keeps the confirmed language/market, validates returned suggestions, distinguishes empty output from completed review, reports failures inline, and bounds waiting to 30 seconds. Closing aborts browser waiting and ignores late output; copy explains that provider work may already have started.
- Users review/edit each suggestion before saving. Text is limited to 1–500 non-whitespace characters. Context is locked after generation; an explicit discard action resets remaining drafts.
- A synchronous lock permits one pending save and prevents double-click duplicates. Close and Escape wait for acknowledgement or the 15-second bound. Successful saves use the actual server row and move focus to the next draft; parent rows are deduplicated by ID.
- Known 400/401/403/404/409 responses preserve an editable draft for correction. Network, timeout, 5xx and malformed acknowledgements retain the draft as **unknown**, block repeating that save and ask the user to close/reload/check the bank. There is no automatic POST retry.
- An unresolved-save warning survives another draft succeeding and survives closing/reopening. Only a fresh server reload reconciles the list. Draft text itself remains in memory only while the panel is open; this change does not promise persistent draft recovery or server-side idempotency.

## Validation and review

Before implementation, both new SSR dialog-name tests failed on the missing dialog contract. Independent review subsequently caught the fixture registry count and an unresolved-warning lifecycle defect; both were corrected. A malformed `409 null` response was separately reproduced with a failing behavior test and corrected. Final independent source review found no remaining important issues.

Local baseline `npm test` passed 5,965 unit cases and failed three existing pinned-network tests in `__tests__/lib/public-url.test.ts` on timeout. Running that boundary with CI mode reproduced the same three failures (39 passed); this is an environment limitation, not a green result. Integration was not run locally because neonctl was unavailable. A Chromium install from the official Playwright distribution failed with an incomplete archive, so browser execution is delegated to CI without weakening the tests.

The patch adds 25 response/write behavior cases, two bilingual SSR cases and 36 browser cases (nine scenarios × EN/zh-HK × desktop/mobile). It replaces two brittle source-text assertions with behavior coverage and registers the real component fixture in the existing production-CSS acceptance harness. Browser cases cover focus/inert background/Escape, axe, touch targets, inline errors, edits, double clicks, known rejection retry, real-row acknowledgement, unknown save recovery, warning persistence, empty output, cancellation/late results and both timeouts. Fixtures use the actual components with synthetic HTTP responses; they do not prove production provider behavior or authenticated SQL.

At the commit checkpoint: 42 focused tests, all 5,951 cases in the non-network local suite, TypeScript, lint and the production build passed. The 42-case network file remains excluded only from this explicitly scoped local run; required CI runs it. Browser discovery found 36 cases; discovery alone is not a browser pass. The PR body records final run URLs/counts without rewriting historical release receipts.

First CI run `38192102708` passed 5,993 unit cases (zero skipped), static/build/Worker and browser shards 1/3. Shards 2/4 then exposed two actual accessibility defects in both locales and viewports: Chromium's native dialog moved Tab out of the document after the last control, and the question-bank count/opener failed contrast (2.51/4.31). Browser total: 986 passed and 8 failed, zero skipped/flaky. The other 28 new drawer cases passed, including ambiguous-save warning persistence and both bounded waits. The patch now explicitly wraps Tab at the enabled-control boundaries, uses accessible theme text for the parent count/opener, and maintains CTA contrast on hover. The original keyboard and axe assertions are retained; fresh candidate CI remains required. The earlier run is preserved as failed evidence, not relabelled as a pass.

## Status and release acceptance

F58 is **implemented / validation pending / not deployed**, not verified_live. Before closing it: all required PR checks must pass on the candidate, inspect the bilingual mobile/desktop screenshots, then after authorized merge/deployment repeat the keyboard journey against the deployed commit. Rollback is a revert of this UI/helper/test patch; it has no SQL migration or new runtime dependency.

F57 remains blocked on the owner's explicit super-admin identity designation. F59 primary Preview configuration, F37 dependency work and the production release gates remain open as documented in `progress.md` and `release-operations.md`. This patch does not apply migrations 063–070, grant a role, change credentials, activate jobs or start paid provider operations.
