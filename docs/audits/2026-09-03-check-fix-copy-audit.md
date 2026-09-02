# Audit: which `fix.*` strings overclaim

**Date:** 2026-09-03
**Scope:** the 120 `fix.pass` / `fix.warn` / `fix.fail` strings in `lib/checkExplanations.ts`
(20 checks × 3 states × 2 locales).
**Status:** report only. **No copy was changed by this audit.**

The `why` copy was rewritten in the same slice. `fix.*` was deliberately left alone so the follow-up
can be sized from evidence rather than guessed at. This is that evidence.

## Method

The same three categories used for `why`:

1. **Unevidenced causal claims** — asserting an outcome the scan does not observe.
2. **Unevidenced magnitudes** — comparatives with no stated basis.
3. **Emerging conventions stated as requirements.**

A fourth pattern turned up that `why` did not have, and it accounts for most of the findings:

4. **Invented numeric thresholds** — a specific number presented as a rule ("at least 3–5 per 1,000
   words"). Nothing in this product measures or derives these figures. They read as expertise and are
   arbitrary.

Clean strings are not listed. A list of everything is not an audit.

## Findings

Every finding appears in **both** locales — the zh-HK copy is a faithful translation, so it carries
the same claim. Each row therefore counts as 2 strings.

| id | state | category | verbatim phrase (en) | verbatim phrase (zh-HK) |
|---|---|---|---|---|
| `c4_structured_data` | warn | 1 — causal/comparative | "Migrate to JSON-LD, which AI models parse **more reliably**" | 「請遷移至 JSON-LD，AI 模型解析起來**更可靠**」 |
| `c6_llms_full_txt` | warn | 4 — invented threshold | "and **at least 5** key page URLs" | 「以及**至少 5 個**關鍵頁面網址」 |
| `c11_faq` | warn | 1 — causal | "Add schema markup so AI models can parse **and cite** your answers" | 「請加入 schema 標記，讓 AI 模型能解析**並引用**你的答案」 |
| `c14_internal_links` | fail | 4 — invented threshold | "**at least 10 links** from your homepage to key pages" | 「由首頁連往關鍵頁面**至少 10 條連結**」 |
| `c15_entity` | warn | 2 — magnitude | "Upgrade to Organization or Person schema **for stronger AI signals**" | 「請升級至 Organization 或 Person schema，**向 AI 發出更強訊號**」 |
| `c17_citation_density` | fail | 4 — invented threshold | "Add **at least 3–5 cited references per 1,000 words**" | 「**每 1,000 字至少加入 3–5 個**引用參考」 |
| `c19_topical_authority` | warn | 4 — invented threshold | "**at least 3–5** supporting cluster articles" | 「配以**至少 3–5 篇**互相連結的支援群組文章」 |
| `c20_chunkability` | warn | 4 — invented threshold | "keep paragraphs **under 200 words**" | 「段落保持在 **200 字以內**」 |

**8 checks affected, 16 of 120 strings (13%).**

By category: 2 causal/comparative (`c4`, `c11`), 1 magnitude (`c15`), 5 invented thresholds
(`c6`, `c14`, `c17`, `c19`, `c20`). No instance of category 3 survives in `fix.*` — the
`llms.txt`-as-requirement framing lived entirely in `why` and is already fixed.

## Deliberately not flagged

`c9_meta_desc` prescribes **50–160 characters**. That is a widely documented and externally
verifiable convention tied to how search engines truncate, not a figure this product invented. It is
the one numeric threshold in the file with a basis outside the copy itself. Flagging it would make
the audit look thorough at the cost of being wrong.

`c5_extractability` fail says the page "**likely** relies heavily on JavaScript" — an inference about
the scanned page, hedged, and directly supported by what the check measures. That is a finding, not a
claim about outcomes.

## Sizing the follow-up

16 strings, 8 checks, both locales. The causal and magnitude findings (`c4`, `c11`, `c15` — 6
strings) are straightforward rewrites of the kind already applied to `why`.

The five invented thresholds are **not** a copy exercise. Each needs a decision before it can be
written: drop the number, keep it and cite a basis, or replace it with a qualitative instruction. That
is a product judgement about how prescriptive the advice should be, and it should be made once and
applied consistently rather than string by string.

Recommendation: treat the 6 causal/magnitude strings as a small copy fix, and the 10 threshold
strings as a separate decision needing sign-off.
