# Conversation Studio concept reference — Stage 0

**設計示例，非產品數據 / design mock — not product data**

This pack fixes the root cause recorded in the design gap plan: implementers
never saw the concept. Stages A/B1/B2 established a capability path inside the
existing dashboard; they did not establish visual parity with this workspace.
Future design briefs should cite this folder and the relevant strings, tokens,
views and screenshot, instead of relying on an accessible live concept URL.

## Source and approval

- Concept: [AISO Conversation Studio](https://aiso-conversation-studio.laichiwillyjp.chatgpt.site/).
- Snapshot date: **2026-10-29 HKT**. Supplied source pack:
  `/workspace/aiso-stage-0-pack/`, including its visual inventory dated the same day.
- A live `curl -L --fail` fetch succeeded on that date. The outer HTML differs
  from the pack only in Cloudflare challenge parameters (request ID/timestamp);
  after normalising those parameters, the outer files match. The live and packed
  `iframe[data-srcdoc]` content both match the supplied inner HTML byte for byte.
  **The supplied pack copies are the committed source**, keeping the screenshots
  and snapshot together. Neither snapshot is a product export.
- Provenance before the required banner/comment insertion (SHA-256):
  outer `51336c13fdd32b6ac2687bbe1defc52f1553266fb51ad1dc2116d467a6931546`;
  inner `07e9f8718da3c626db2bf45f8bfbe0077b3361dfab22a74f93ba5be278c4835b`.
- Willy Approve via Rio/AISO, **2026-10-29 HKT**: Stages **0–5 continuous**;
  Stage 5 **Layout B full-bleed**. This delivery implements **Stage 0 docs only**,
  based on `main@0766bdf67d40efde428c44b51c274a7b632345c7`.
- Authoritative input: `/workspace/aiso-brief-studio-design-stage-0.md`; context:
  `/workspace/aiso-studio-design-gap-and-plan.md` (especially §3.4 and Stage 0).
  These workspace paths are provenance, not portable repository dependencies.

## File index

| File | Purpose |
| --- | --- |
| [concept-outer.html](concept-outer.html) | Original host wrapper, including its encoded `data-srcdoc` and bootstrap |
| [concept-inner.html](concept-inner.html) | Decoded `data-srcdoc`; best entry point for viewing the concept directly |
| [screenshots/01-home.webp](screenshots/01-home.webp) | Home / 開始工作 |
| [screenshots/02-discussion.webp](screenshots/02-discussion.webp) | Discussion / 討論 |
| [screenshots/03-threads.webp](screenshots/03-threads.webp) | Thread list / 討論串 |
| [screenshots/04-connections.webp](screenshots/04-connections.webp) | Connectors / 資料連接 |
| [STRINGS.md](STRINGS.md) | Verbatim concept copy, proposed i18n keys and English drafts |
| [TOKENS.md](TOKENS.md) | All concept `--as-*` variables and Stage 1 mapping proposal |
| [VIEWS.md](VIEWS.md) | Views, interactions, existing implementation references and Stages 1–5 |

Both HTML files have an added top comment and visible body banner carrying the
mock label above; their remaining bytes are preserved. The outer file's encoded
inner payload stays unchanged. Screenshots are unmodified pack copies and show
the concept's existing “示例” labelling; all brands, documents, records and states
visible in them are mock data.

## Viewing and viewport notes

Open `concept-inner.html` in a browser from disk; the concept contains its own
inline layout, view switching, sample replies and sample state. Its interactions
simulate work and do not establish real model, connector or save capability.
The outer wrapper is useful for reproducing host framing.

The original snapshots include external CDN scripts (Floating UI and Lucide),
host bridge code and, in the outer wrapper, Cloudflare challenge code. **No
external scripts were added.** A fully disconnected browser may omit icons or
host helpers; the four WebP files provide fixed visual references without those
dependencies. The standalone concept copy is zh-TW-labelled written Traditional
Chinese; the English column in STRINGS is a draft, not an English screenshot.

| Reference | What is known |
| --- | --- |
| Supplied four WebP files | Each is **1280×800 pixels**, including browser chrome. Browser viewport/device scale and capture zoom are not recorded. |
| Outer host | Iframe is `width:100%; max-width:736px`; body has 16px padding. Browser width is not the same as concept width. |
| Desktop comparison target | **1440px** viewport for later stages; open the inner file directly for full-width component comparison. This pack does not claim a 1440px capture. |
| Intermediate layout | At ≤900px, the rail becomes 178px and the 240px inspector moves below the answer. Above 900px, the rail is 205px. |
| Mobile comparison target | **390px** viewport for later stages; at ≤620px the rail hides behind a menu, cards become one column, the heading becomes 26px and action targets become at least 44px. No 390px screenshot was supplied or recaptured in Stage 0. |

These breakpoint notes come from the snapshot CSS, not a completed responsive
product acceptance run. The approved Stage 5 Layout B uses a full-bleed Studio
shell; the outer host's width cap is not a product layout requirement.

## Stage 0 local sanity

JSON parsing and the single-entry Vercel config comparison pass. All 60 relative
Markdown links resolve; all 11 concept variables are mapped; all 112 copy mapping
rows match the concept/plan verbatim, with key existence checked in both catalogs.
The HTML matches its sources after removing only the two required insertions;
the four images match byte for byte. `git diff --check` passes. Config inspection
places HTML outside lint/typecheck/test discovery. No Markdown lint/formatter is
configured. `npm run lint` was attempted but could not run (`eslint: not found`;
dependencies are absent). No app build, typecheck, unit or full E2E run is claimed.

## Hard holds

- **Production FEATURE OFF throughout.** No environment writes or flag changes.
  `STUDIO_LIVE_ANSWERS_PER_WEEK` retains its default 0; this pack grants no spend.
- Honesty remains mandatory: no invented metrics, rankings, coverage or success
  claims; missing answers never mean zero mentions; citations do not prove a
  search ran; live model output remains explicitly unverified. Do not display a
  Hong Kong/Traditional Chinese ChatGPT Mentions score based on US/English coverage.
- **Harbour Home, Harbour Tea, `/compare`, 產品資料 v3, 品牌語調 v2,
  WI-DEMO-01, recent threads, approval badges, dates/ranges and sample connector
  bindings are mock-only and MUST NOT appear as product data.** In particular,
  “Search Console · 示例已綁定” is never a fallback binding status. Use actual
  owned records or explicit “待核實”, “未連接”, “未有紀錄” states.
- **Stage 6 NO_GO** until separate Willy Approve: no thread persistence/ACL,
  attachment-to-model flow, work-item saves, new connector/vendor calls, schema
  changes or durable quota implementation. The inventory describes those holds.
- This branch changes only `docs/**` and the exact branch deploy-disable entry
  in [vercel.json](../../../vercel.json). No app UI/runtime work, merge,
  ready-for-review action or Production FEATURE ON is authorized by this delivery.
- Draft PR → CI green → **HOLD** for AISO's new Extra High PR-diff brief.
  Stop after the draft PR and tip SHA; do not start Stages 1–6 here.
