# V2 owner outcome sample

The main English and zh-HK previews use a genuine frozen V2 review containing a
Scan source, a Pulse source and a repeated Scan source. Each frozen entry keeps its
own place and result. A separate one-source example is still schema 2; the legacy
V1 example remains available for regression. This is a controlled local sample,
not a production session or a record of SME participant acceptance.

## Open or reproduce the sample

Use Node 24 and the repository's locked dependencies. From the repository root:

```sh
npm ci
npm run build
node scripts/sme-preview.mjs --output artifacts/sme-preview
```

The [generator](../../scripts/sme-preview.mjs) uses actual production-build CSS and
the [journey renderer](../../__tests__/components/journey-render.test.tsx). Open one
of the generated HTML files directly in a browser; no server or credentials are
needed. The files are self-contained.

```text
en-preview.html                         mixed/duplicate V2, English
zh-HK-preview.html                      mixed/duplicate V2, zh-HK
en-v2-one-scan-preview.html              one-source V2, English
zh-HK-v2-one-scan-preview.html           one-source V2, zh-HK
en-v1-scan-preview.html                  legacy V1, English
zh-HK-v1-scan-preview.html               legacy V1, zh-HK
manifest.json                           artifact, source and dependency provenance
```

The manifest records hashes of the generated artifacts, selected source files and
lockfile, plus the checkout revision. A modified working tree is identified by its
source hashes, not established as a released deployment by its checkout revision.
The generator checks every recorded artifact hash before finishing. Regenerate
from the final reviewed revision when distributing a particular sample.

## Follow the owner journey

1. Open the main sample and resume the saved work from Today. Inspect the supplied
   draft. Keep it unchanged, or copy the exact alternative title, action and notes
   from the sample instructions before saving. Those are alternative first
   submissions, not two historical versions.
2. Prepare the saved work for review. Inspect the frozen sources and then switch
   to the sample independent reviewer. Record an explicit decision and reason.
   Switching this demonstration actor does not sign in or grant a real role.
3. Return to the sample owner. Open the manual-delivery route and enter a
   destination, note and the supported declared delivery instant from the
   instructions. The V2 example uses **2026-10-24 00:10 UTC**. Recording it is a
   self-reported declaration; it does not edit or verify a website.
4. Read the saved outcomes. The early sample clock can leave windows not due. The
   repeated Scan remains a separate frozen entry; it is not silently merged into
   its sibling. Pulse collection success does not become an improvement ranking.
5. Advance the fictional sample clock, then press the existing refresh button in
   **Saved outcomes**. The later V2 clock is **2026-11-07 00:15 UTC**. D7 covers
   **2026-10-31 00:10 UTC inclusive to 2026-11-07 00:10 UTC exclusive**. The retained
   November 1 Scan observation is a partial comparison from warn to pass; its
   final-path limitation remains. D28/D56 are still not due. Pulse stays unranked.
6. Try the saved-record choices, then refresh Saved outcomes again. An unavailable
   or limited Scan affects its Scan entries while the Pulse entry remains visible.
   Many undated records explain uncertainty and diagnostic limits. No option
   starts a new scan or provider collection.
7. Try a read failure and retry the affected section. Outcome refresh/retry only
   reads retained evidence. It preserves review/delivery fields and does not
   submit a decision, delivery, withdrawal, export or handoff. A failed delivery
   reply may follow a committed record: use **Refresh delivery permissions** in
   the delivery section to reconcile its retained history. Outcome refresh does
   not restore delivery authority or prove the write failed.
8. If correcting the declaration, withdraw it with a reason and record the
   replacement. Inspect the current anchor and the old history separately. Use
   Reset sample for another complete attempt or to return to the earlier clock.
   Reset clears the local work; it is not a rewind that retains those records.

Source labels and limitations appear before any admitted change. IDs, hashes,
exact timestamps and retained diagnostic references are available in native
read-details disclosures. There is no package-wide success badge, combined score
or causal business-impact claim.

## Exact offline bounds

The standalone transport supports either of two supplied draft texts, one
prepared review version, the listed delivery instant, two declared deliveries and
their withdrawals. Replaying an identical request does not consume another event.
Other text can be explored, but an unsupported revision, delivery instant or
additional correction returns an explicit sample-bound error. Reset begins a
fresh attempt.

The two clock values form a one-way sample timeline until reset. Record choices
change only the finite sample data; clock/profile controls do not remount review
forms or automatically fetch. The owner then uses the ordinary Saved outcomes
refresh action. These sources are supplied in advance: this sample does not
establish source attachment or removal UX.

The [portable engine](../../__tests__/sme-journey/transport.ts) combines the actual
local decision/delivery history with Node-projected source inputs and the actual
browser-safe outcome policy. The separate
[Node factory](../../__tests__/sme-journey/scenario.node.ts) and
[projection adapter](../../__tests__/sme-journey/projection.node.ts) support genuine
edited later versions for engineering history witnesses. That broader Node path
is not advertised as an offline feature.

The emitted browser graph rejects Node, database, server-only and factory modules.
The existing Node bundle uses real Node SHA and a throwing database guard; emitted
and source projections are compared using the same actual committed sample
snapshot. The standalone HTML omits production font-face declarations from its
embedded CSS and keeps local Arial/platform CJK fallbacks. The production CSS
artifact remains intact; the manifest records both stylesheet hashes and the
number of omitted font faces. The preview's CSP still blocks fonts, connections
and forms, and unsupported native network destinations fail instead of falling
through to the network.

## Evidence and participant use

Use the [seven-task SME script](sme-activation-usability.md) with the
[blank observation template](sme-activation-observations.md). For V2, also ask the
participant to distinguish the three frozen entries, explain the partial Scan
comparison and explain why Pulse has no improvement rank. Record actual help and
confusion before attributing a cause. The owner arranges real participants.

Human observations remain **zero supplied / pending**. Four of five independent
participants is a proposed target, not an achieved result. Node parity, controlled
browser automation and guarded empty production reads cannot supply participant
scores, authenticated permissions, provider execution, verified publication or
causal business results. Release status belongs to the particular exact-head
CI/merge/Ready/canonical receipt in the
[approved milestone](sme-outcome-workflow.md).
