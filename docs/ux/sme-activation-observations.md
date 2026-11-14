# SME trial observations and issue triage

**Status: pending; no participant observations recorded.** This reusable template
is not a recruitment list, completed trial or acceptance result. The owner arranges
five actual SME participants. Four of five is a proposed target only.

Use the [seven-task bilingual script](sme-activation-usability.md) and the generated
[controlled sample](sme-activation-preview.md). Run the supplied offline sample;
production sign-in, package export, provider actions and real account writes need
their own scoped authorization. Demonstration actor switching does not test real
permissions. Do not use a live Studio skill as a provider-free substitute: see the
[capability ledger](sme-capability-readiness.md).

## Run record / 測試設定

Copy this section per actual participant. Leave values blank until observed; use a
pseudonymous code, not a name, email address or customer account identifier. Preserve
an unfilled master copy. The operator keeps actual observations separately from
source-controlled engineering evidence unless their inclusion is explicitly agreed.

| Field / 欄位 | Actual value / 實際記錄 |
| --- | --- |
| Run and pseudonymous participant code / 測試及參與者代號 | |
| SME role and relevant experience / 店主角色及相關經驗 | |
| Observer code / 觀察者代號 | |
| Actual date, local start time and time zone / 實際日期、開始時間及時區 | |
| Sample manifest commit, source/artifact hashes and scenario / manifest、雜湊及情境 | |
| Browser, device and viewport / 瀏覽器、裝置及畫面寬度 | |
| Language and theme / 語言及主題 | |
| Reset/initial state confirmed / 已確認重設及起始狀態 | |
| Completed, stopped early or recording incomplete / 已完成、提早停止或記錄不全 | |
| Supported sample revision, errors armed and when / 示例版本、設定錯誤及時間 | |

Give one task at a time. Record the prompt used, elapsed time and exact actions
before inferring why something happened. Do not point to a button or explain its
technical meaning during an independent attempt. Help is permitted after recording
the unaided outcome; record the exact hint and subsequent assisted outcome.
The source's fixed 2026-11-14 UTC delivery time is sample data, not the trial date.

The main scenario requires task 2 to submit the review and task 4 to approve the
supplied acceptable content before manual tasks 5/6. These are scenario conditions,
not navigation hints. A changes-requested decision can be explored in a separate
reset/run; the standalone sample cannot freeze a second version after submission.
If an observer/setup/branch condition prevents a later task, record not attempted
with that cause and the original run, rather than inventing an independent pass or
attributing the blocked task to usability. Preserve it in cohort limitations; any
retest uses a new run ID and does not erase the started participant or original result.

| Task | Prompt used | Independent / assisted / incomplete / not attempted | Elapsed time | Exact behavior or quote | Hint and when | Error/recovery or observer limitation |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

## Consistent scoring / 一致判準

- **Independent / 獨立完成:** completes the requested task and explains its result
  without navigation hints, technical explanations or an observer demonstration.
  Reading the agreed task prompt is not a hint; additional guidance is assistance.
- **Assisted / 協助完成:** completes after any such help. Preserve the unaided
  attempt and the help rather than relabeling it independent.
- **Incomplete / 未完成:** attempts but stops, chooses an incorrect result or cannot
  explain it. Record a sample defect separately; do not silently count it as success.
- **Not attempted / 未嘗試:** no attempt was observed. Missing records, observer-only
  demonstrations and automated tests do not count as independent completions.

The proposed four-of-five measure concerns the same four core objectives below.
A participant must independently complete **all four** to count toward that target.
Record tasks 2, 4 and 7 as well, including assisted recovery; they do not substitute
for a missing core objective. Task 5 explicitly names the manual route, so this
measures locating/using that prompted route, not an unprompted choice among routes.

| Core objective | Script task | Required observed behavior |
| --- | --- | --- |
| Resume work / 繼續工作 | 1 | Opens the previously saved work from Today and explains its current next step |
| Explain blocker / 解釋阻礙 | 3 | Explains why the submitting owner cannot independently finish review, and what the view still cannot establish |
| Use prompted delivery route / 使用指定交付途徑 | 5 | Locates manual recording, enters supplied sample values and recognizes that this records an assumed/self-reported delivery |
| Distinguish evidence / 分辨證據 | 6 | Separates a delivery record from verified website change and later observation; does not claim improvement from not-due windows |

For any actual cohort, report invited/recruited/started/completed counts separately,
then the exact number completing all four independently. Do not drop a started
participant because they struggled, stopped or needed help. If fewer than five
actual SME attempts are recorded, report the observed denominator and leave the
five-person target pending; do not extrapolate. Record sample/observer failures and
retests with new run IDs, keeping the original result. A proposed product decision
must name the cohort and evidence, rather than treating this target as certification.

## Cohort summary / 同組結果

Leave this table unfilled until actual runs exist. A blank cell is unknown, not a
pass, zero, participant identity or scheduled commitment.

| Cohort ID | Recruited / started / completed | Independent on all four / actual started | Task-specific assistance and incomplete counts | Relevant run IDs | Target pending / met / not met | Limitations |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

## Issue triage / 問題排序

Separate observed behavior from the suspected cause and the proposed fix. Attach
only agreed redacted evidence. A source-only finding can enter the engineering
backlog, but it must not be attributed to a participant or assigned a fabricated
frequency. Verify a suspected behavior against the current implementation before
changing public contracts or authority.

| Issue ID | Evidence type: human observation / source audit / controlled test | Run/task or dated source reference | Exact finding and frequency denominator | Impact | Suspected cause, still to verify | Proposed fix | Priority and reason | Validation / owner / status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | |

Use **P0** for a confirmed data/authority/cost-control failure needing immediate
containment; **P1** for blocked core work or materially misleading action/evidence
copy; **P2** for a recoverable hesitation or secondary navigation issue; **P3** for
cosmetic improvements. State whether impact is observed or potential. Priority is
a triage decision, not proof of cause or frequency. Re-test a proposed fix using the
same objective and a newly identified sample/commit.

Current source-confirmed capability boundaries are in the dated capability ledger.
There are no human findings in this template. Bring actual observations into the
[approved next milestone](sme-outcome-workflow.md) to prioritize Chat/MCP/Skill
navigation and wording; the confirmed V2 outcome engineering gap can proceed in
parallel.
