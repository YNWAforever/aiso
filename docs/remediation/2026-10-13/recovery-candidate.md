# T23 — F58/F59/F60/F63 combined recovery candidate
PR90 source merged locally at14a40d8e; PR92 source already imported at6897fece. Both GitHub PRs remain unchanged by this work.

Changes beyond imported fixes:
- Native drawer preserves prior body overflow, locks background while open, and restores it after close.
- Next16 error page uses retry (server refresh plus reset); legacy reset alone did not recover a cleared server fault.
- Pricing Cell is relative so its sr-only labels stay inside the named horizontal scroll region at200% text. Header hypothesis was disproved and reverted.
- Default404/noindex synthetic error page is gated by existing E2E_FIXTURE_MODE; unit guard proves it reads no cookies unless enabled. Release must keep fixture mode off.

RED:2 true error callback tests;1 actual Next server recovery case;2 real drawer wheel cases;4 pricing reflow cases. Retained failures/traces.
GREEN:31/31 targeted unit;28/28 actual Next public cases across EN/zh-HK,light/dark,375/768/1440;24/24 real drawer/editor fixture browser cases including focus trap,Escape/opener,unknown save/reopen,double click once,body scroll.0 skipped. Initial error HTTP status500 measured for all12 server scenarios; successful retry re-fetches actual server segment.
Build,lint,typecheck passed. Fixture generation131/131 is a supporting subset, not the full suite.
Environment:synthetic localhost; socket/fetch guard on; native sharing/provider/DB writes absent. Test cookies cleared; owned servers stopped.
UC40/54/55/57 local scopes passed;UC46/56/76 hosted/combined final CI portions remain blocked/pendingT36. No verified_live claim.
Rollback:revert compatible UI/test commit; no schema,Auth policy,Worker,provider or production mutation.
