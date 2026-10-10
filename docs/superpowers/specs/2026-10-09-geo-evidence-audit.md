# GEO evidence audit specification

The user requested a complete best-effort audit and repair of AISO, using AnsVisor's repository and authenticated product as a reference. Production is still on main f49e1bd; the previous repair PR #68 is unmerged. This repair branch starts at its head 8a276a6 and must preserve that work.

## Evidence and intended behavior

- Production accepted `not-a-valid-url`, stored a scan with zero collected pages, and displayed 4/100 plus unsupported crawler-blocking advice. Reject invalid public hostnames before quota/provider work. If the origin page fails, is an HTTP error, is empty, or is explicitly non-document content, return a safe retryable error before checks, score insertion, or webhooks.
- AnsVisor's authenticated prompt detail exposes original responses and provider citations separately from brand mentions. AISO currently discards OpenRouter `message.annotations`. Preserve safe public URL citations in the accepted attempt, with nullable provenance for older records. Explicitly distinguish provider citations from ordinary URLs written in an answer. Never infer a brand citation from either.
- Empty answers and truncated Pulse responses must not count as successful collection. Preserve valid provider usage; malformed or negative usage must stay unknown rather than make a database write fail.
- The public scan assesses website readiness. Actual AI mention/citation evidence comes from sampled model API responses and is not consumer ChatGPT or Google AI Overviews coverage. Correct the homepage promise accordingly.

## Constraints

- Node 24, Next 16.2.4, no new runtime dependency.
- Every database read/write remains account/client scoped; existing lease/fence transaction semantics remain intact.
- Additive migration only; no historical evidence fabrication or destructive backfill.
- User-facing copy in both en and zh-HK.
- No new paid models, search plugins, production flags, external schedules, or account/security changes.
- AISO Google login was rejected by automatic approval review; it remains blocked pending explicit authorization. AnsVisor Google login was authorized and succeeded.
- Production migration/deployment remains separate from verified source repair; existing release gates are not bypassed.

## Coverage limits

This pass cannot prove every authenticated AISO flow, live provider job, or production migration. Record these separately from unit/build verification and from historical audit receipts. Do not label the entire product fully fixed or deployed.
