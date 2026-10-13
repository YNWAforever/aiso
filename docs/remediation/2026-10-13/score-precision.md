# T20 — F61 scan score precision
Candidate implementation: shared `formatScanScore`; stored scores and `assignGrade` unchanged.

| Consumer | Evidence / change |
| --- | --- |
| result/ScoreReveal | real scorer 59.97/D reproduced as 60.0; shared formatter and bounded animation |
| ScoreRing → ScanSummary / owned result | fractional total rounded; shared formatter |
| result Open Graph image | rounded fractional total; shared formatter; absent DB score remains unknown |
| RecentScans, WorkspaceHome, result metadata | existing raw numeric rendering already preserves persisted precision |
| ShareButton native share text | existing raw score interpolation preserves decimals |
| reports/snapshot and saved report data | raw numeric values retained; no persisted value rewrite |
| visibility, pillar percentages, money | excluded from scan total formatting |

Local unit: 60/60 passed, 0 failed/skipped. Includes the unchanged behavioral assertions from the original RED repro and true grade oracle.
Actual Chromium component fixture: 52/52 passed across EN/zh-HK, normal/reduced motion and fractional/integer thresholds. No HTTP/provider/Auth/DB calls. The initial 8-case RED and normal-frame failure are retained in private execution evidence.
Lint: 0 errors; 1 pre-existing warning in the archived Worker pause bundle. Typecheck passed after excluding only the immutable archived repro from compilation; the active repro compiles and executes.
UC44 / UC60: local precision portion passed. Native hosted sharing and full-page acceptance remain T22; no verified_live claim.
Rollback: revert this UI/helper commit; no score, grade, schema or runtime mutation.
