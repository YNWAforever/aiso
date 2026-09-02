# Check copy: editorial restraint and the `question` field — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the 20 checks' explanatory copy asserting outcomes the product cannot evidence, and add the donor's plain-language `question` field in both locales.

**Architecture:** All copy lives in `lib/checkExplanations.ts`, which already holds two parallel locale records. The type gains a required field first, so `typecheck` itself proves every entry was populated. Rewrites follow, then consumers, then a guard.

**Tech Stack:** TypeScript 5.9, Vitest 4, next-intl 4.

**Spec:** `docs/superpowers/specs/2026-09-03-check-copy-editorial-restraint-design.md`

---

## Background

`lib/checkExplanations.ts` exports `CHECK_EXPLANATIONS` (en, lines 6–168) and
`CHECK_EXPLANATIONS_ZH_HK` (lines 169–331), plus `getCheckExplanations(locale)`. Both records are
complete for all 20 checks. **There is no translation gap** — do not "add translations".

The problem is editorial. The copy asserts outcomes the scan does not observe. The worst example is
`c11_faq`, which claims FAQ pages are **"cited 3× more often by AI search engines"** — a specific
multiplier with nothing behind it, in a product that audits other people's websites. The zh-HK entry
carries the same claim (「引用的頻率高 3 倍」).

**The principle:** keep concrete, verifiable detail; remove asserted outcomes the product cannot
evidence. Keep named crawlers, formats, fields and actions — those are checkable.

**Six checks are already clean and MUST NOT be touched:** `c3_bot_access`, `c5_extractability`,
`c8_sitemap`, `c10_headings`, `c12_canonical`, `c13_render`. They describe mechanism and hedge
appropriately. Rewriting them for style is out of scope and will be rejected in review.

The donor repository supplies the `question` field. Clone it if absent:

```bash
git clone https://github.com/YNWAforever/aisogpt.git /tmp/aisogpt-donor
git -C /tmp/aisogpt-donor checkout 52cbcb4e753e4486afc9af9c3b574948d8e34436
```

Its `app/repo-scan-truth.ts` holds `REPO_SCAN_CHECKS`, whose 20 ids match this repository's exactly
(verified id-by-id, no gaps either direction). Each entry's array fields are ordered `[zh, en]` —
**zh first**, which is the reverse of what you will assume.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `lib/checkExplanations.ts` | All check copy, both locales | Modify |
| `app/[lang]/dashboard/[clientId]/result/[scanId]/page.tsx` | Dashboard result page | Modify (locale bug) |
| `components/dashboard/ScanSummary.tsx` | Dashboard summary | Modify (locale bug) |
| `components/ExpandableCheckItem.tsx` | Renders one check | Modify (render `question`) |
| `__tests__/lib/check-explanations-parity.test.ts` | Guard | Create |
| `docs/audits/2026-09-03-check-fix-copy-audit.md` | `fix.*` audit output | Create |

---

### Task 1: Add the required `question` field

**Files:**
- Modify: `lib/checkExplanations.ts`

- [ ] **Step 1: Extract the donor's question strings**

Run this from the repository root, with the donor cloned as above:

```bash
python - <<'PY'
D = "/tmp/aisogpt-donor"
d = open(D + "/app/repo-scan-truth.ts", encoding="utf-8").read()
rows = []
i = 0
while True:
    i = d.find('{ id: "', i)
    if i < 0: break
    cid = d[i+7 : d.find('"', i+7)]
    seg = d[i : d.find("},", i)+2]
    k = seg.find("question: [")
    body = seg[k+11 : seg.find("]", k)]
    zh, en = body.split('", "')
    rows.append((cid, zh.strip('"'), en.strip('"')))
    i += 1
print(len(rows), "checks")
for cid, zh, en in rows:
    print("%s\n  en: %s\n  zh: %s" % (cid, en, zh))
PY
```

Expected: `20 checks`, then each id with both strings. If it prints fewer than 20, stop and report —
the donor file's shape has changed.

- [ ] **Step 2: Make the field required in the interface**

In `lib/checkExplanations.ts`, replace lines 1–4:

```ts
export interface CheckExplanation {
  why: string
  fix: { pass: string; warn: string; fail: string }
}
```

with:

```ts
export interface CheckExplanation {
  /**
   * The plain-language thing this check is asking, in the user's locale.
   * Required, not optional: an optional field lets a check ship without one
   * and nothing notices until a user sees a blank row.
   */
  question: string
  why: string
  fix: { pass: string; warn: string; fail: string }
}
```

- [ ] **Step 3: Run typecheck and watch it fail 40 times**

Run: `npm run typecheck`

Expected: FAIL, with `error TS2741` (or `TS2739`) once per entry missing `question` — 20 in
`CHECK_EXPLANATIONS` and 20 in `CHECK_EXPLANATIONS_ZH_HK`. This is the completeness check: the
compiler, not a human, guarantees no entry is skipped.

- [ ] **Step 4: Add `question` to all 40 entries**

Add a `question` line as the first property of every entry in both records, using the English string
from Step 1 for `CHECK_EXPLANATIONS` and the Chinese one for `CHECK_EXPLANATIONS_ZH_HK`. For example
`c1_robots` becomes:

```ts
  c1_robots: {
    question: 'Are public pages available to declared crawlers?',
    why: '…unchanged in this task…',
    fix: { /* unchanged */ },
  },
```

and in the zh-HK record:

```ts
  c1_robots: {
    question: '搜尋系統是否獲准讀取公開頁面？',
    why: '…unchanged in this task…',
    fix: { /* unchanged */ },
  },
```

Do not modify `why` or `fix` in this task.

- [ ] **Step 5: Run typecheck to verify it passes**

Run: `npm run typecheck`
Expected: exit 0, no `error TS` lines.

- [ ] **Step 6: Commit**

```bash
git add lib/checkExplanations.ts && git commit -F- <<'EOF'
feat(checks): add a required bilingual question field to check explanations

Sourced from the aisogpt donor at 52cbcb4, whose 20 check ids match this
repository's exactly. The field states in plain language what each check is
asking, which nothing in the current copy does.

Required rather than optional deliberately: an optional field lets a check ship
without one and nothing notices until a user sees a blank row. Making it
required turns tsc into the completeness check -- it flagged all 40 missing
entries across the two locale records.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Rewrite the 14 overclaiming `why` strings, both locales

**Files:**
- Modify: `lib/checkExplanations.ts`

Replace the `why` value for each id below, in **both** records. Everything else stays. **Do not touch
`c3_bot_access`, `c5_extractability`, `c8_sitemap`, `c10_headings`, `c12_canonical`, `c13_render`.**

- [ ] **Step 1: Apply the English rewrites**

| id | new `why` (en) |
|---|---|
| `c1_robots` | AI crawlers like GPTBot, ClaudeBot and PerplexityBot read robots.txt before fetching a page. Blocking rules there can prevent an allowed crawler from retrieving your content. |
| `c2_llms_txt` | llms.txt is an emerging content-map convention, not a ranking or citation requirement. Where it is read, it describes what your site covers and which pages matter most. |
| `c4_structured_data` | JSON-LD schema markup gives AI models machine-readable context about your content — what type of page it is, who wrote it, and what it's about. Without it, that context has to be inferred from the prose. |
| `c6_llms_full_txt` | A minimal llms.txt — the file with no real content — carries almost no information. A structured file with a description and multiple URL entries describes your site to any tool that reads it. |
| `c7_mcp_card` | Some emerging AI tools look for /.well-known/ai.json for structured information about your site. Adoption is early and the convention is not settled, so treat this as optional rather than foundational. |
| `c9_meta_desc` | The meta description is the page summary you control. Search and AI tools may use it when presenting your page, so a concise, accurate description (50–160 characters) is worth writing deliberately. |
| `c11_faq` | FAQPage JSON-LD marks a question and its answer as a discrete, machine-readable pair. That makes each answer easier to extract on its own, without a model having to infer where the answer starts and ends. |
| `c14_internal_links` | Internal links are how a crawler moves between your pages. A page with no inbound internal link can only be found through the sitemap or an external link. |
| `c15_entity` | Organization and Person schema states who is behind the content in a machine-readable form, rather than leaving authorship to be inferred from the page. |
| `c16_freshness` | dateModified and datePublished in your JSON-LD state when the content was last reviewed. Without them, age has to be guessed from the content itself. |
| `c17_citation_density` | Citing authoritative external sources lets a reader — or a model — verify a claim. Citation density supports verification; it does not by itself produce an AI citation. |
| `c18_factual_density` | Concrete data — percentages, named entities, dates, comparative figures — can be checked against a source. Vague or superlative-heavy claims cannot, by anyone. |
| `c19_topical_authority` | Covering a topic across a pillar page and linked supporting articles gives a reader more than one place to land, and makes the relationship between those pages explicit. A single isolated page states less about its own context. |
| `c20_chunkability` | AI models extract answers in chunks of roughly 100–1,500 tokens. Content organised under clear headings, with self-contained answer-first paragraphs, gives them a natural place to cut. |

Note `c4_structured_data`'s existing value uses an escaped apostrophe (`what it\'s about`). Keep that
escaping, or switch the whole string to double quotes — either compiles, but do not leave a bare `'`.

- [ ] **Step 2: Apply the zh-HK rewrites**

| id | new `why` (zh-HK) |
|---|---|
| `c1_robots` | GPTBot、ClaudeBot 與 PerplexityBot 等 AI 爬蟲在讀取頁面前會先查看 robots.txt。當中的封鎖規則可能令獲准的爬蟲無法讀取你的內容。 |
| `c2_llms_txt` | llms.txt 是新興的內容地圖慣例，並非排名或引用的必要條件。在有讀取的情況下，它說明你的網站涵蓋什麼內容，以及哪些頁面最重要。 |
| `c4_structured_data` | JSON-LD schema 標記為 AI 模型提供關於你內容的機器可讀脈絡 — 頁面屬於甚麼類型、由誰撰寫、講述甚麼主題。沒有它，這些脈絡只能從文字中推斷。 |
| `c6_llms_full_txt` | 一份只有檔案、沒有實質內容的 llms.txt 幾乎不帶任何資訊。一份結構完整、附有描述及多個網址條目的檔案，能向任何會讀取它的工具說明你的網站。 |
| `c7_mcp_card` | 部分新興 AI 工具會檢查 /.well-known/ai.json 以取得你網站的結構化資訊。此慣例仍在早期階段、尚未定型，宜視為可選項目而非基礎工作。 |
| `c9_meta_desc` | Meta description 是你能自行控制的頁面摘要。搜尋及 AI 工具在呈現你的頁面時可能會採用它，因此值得認真撰寫一段簡潔準確的描述（50–160 字元）。 |
| `c11_faq` | FAQPage JSON-LD 把問題與答案標記為獨立、機器可讀的一組。這讓每個答案更容易被單獨提取，模型無須自行推斷答案的起訖位置。 |
| `c14_internal_links` | 內部連結是爬蟲在你的頁面之間移動的途徑。一個沒有任何內部連結指向它的頁面，只能透過 sitemap 或外部連結被發現。 |
| `c15_entity` | Organization 及 Person schema 以機器可讀的方式說明內容背後是誰，而非讓署名資訊只能從頁面內容推斷。 |
| `c16_freshness` | JSON-LD 中的 dateModified 及 datePublished 說明內容最後審閱的時間。沒有這些欄位，內容的新舊只能從內文推斷。 |
| `c17_citation_density` | 引用權威外部來源，讓讀者或模型能夠核實論述。引用密度有助查證，但本身並不代表會獲 AI 引用。 |
| `c18_factual_density` | 具體資料 — 百分比、具名實體、日期、比較數字 — 可以對照來源查證。空泛或充斥誇張字眼的說法，任何人都無從核實。 |
| `c19_topical_authority` | 以支柱頁加上互相連結的支援文章覆蓋同一主題，能為讀者提供多個入口，也讓頁面之間的關係更明確。單一孤立的頁面能交代的脈絡較少。 |
| `c20_chunkability` | AI 模型以大約 100–1,500 個 token 為單位提取答案。內容若在清晰標題之下、以自成一體、答案先行的段落組織，便有自然的切分位置。 |

- [ ] **Step 3: Verify the fabricated statistic is gone**

Run: `grep -n "3×\|3 倍\|significantly more likely\|遠高於\|invisible to every\|完全隱形" lib/checkExplanations.ts`

Expected: **no output.** Any match means an overclaim survived.

- [ ] **Step 4: Verify the six clean checks are untouched**

Run: `git diff lib/checkExplanations.ts | grep -E "^[-+].*(c3_bot_access|c5_extractability|c8_sitemap|c10_headings|c12_canonical|c13_render)"`

Expected: only lines adding `question:` from Task 1 — no `why` or `fix` changes for those six.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — expected exit 0.

```bash
git add lib/checkExplanations.ts && git commit -F- <<'EOF'
fix(checks): remove claims the scan cannot evidence from check copy

Fourteen of twenty `why` strings asserted outcomes this product does not
measure. The worst claimed FAQ pages are "cited 3x more often by AI search
engines" -- a specific multiplier with nothing behind it, in a product that
audits other people's websites. The zh-HK copy carried the same figure.

Three categories removed: unevidenced causal claims ("invisible to every AI
search engine"), unevidenced magnitudes ("significantly more likely to be
quoted verbatim"), and emerging conventions stated as requirements ("the AI
equivalent of sitemap.xml"). Named crawlers, formats, fields and actions are
kept -- those are checkable.

Six checks already described mechanism honestly and are untouched:
c3, c5, c8, c10, c12, c13.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Fix the locale bug and render `question`

**Files:**
- Modify: `app/[lang]/dashboard/[clientId]/result/[scanId]/page.tsx`
- Modify: `components/dashboard/ScanSummary.tsx`
- Modify: `components/ExpandableCheckItem.tsx`

Two consumers import the English constant directly, so a zh-HK user sees English explanations on the
dashboard today. `components/result/ResultClient.tsx:128` already does this correctly and needs no
change.

- [ ] **Step 1: Confirm the bug before fixing it**

Run: `grep -n "checkExplanations" "app/[lang]/dashboard/[clientId]/result/[scanId]/page.tsx" components/dashboard/ScanSummary.tsx components/result/ResultClient.tsx`

Expected: the first two import `CHECK_EXPLANATIONS`; the third imports `getCheckExplanations`.

- [ ] **Step 2: Fix the page**

In `app/[lang]/dashboard/[clientId]/result/[scanId]/page.tsx`, change the import at line 10 from
`CHECK_EXPLANATIONS` to `getCheckExplanations`, resolve the locale from the route's `lang` param the
page already receives, and replace the use at line 241:

```tsx
const explanations = getCheckExplanations(lang)
// …
explanation={explanations[key]}
```

- [ ] **Step 3: Fix ScanSummary**

`components/dashboard/ScanSummary.tsx` already imports `useLocale` from `next-intl` at line 1. Change
the import at line 5 to `getCheckExplanations`, and at line 97 replace
`const explanation = CHECK_EXPLANATIONS[key]` with a lookup against `getCheckExplanations(locale)`,
resolving `const locale = useLocale()` once at the top of the component — not inside the loop.

- [ ] **Step 4: Render the question**

`components/ExpandableCheckItem.tsx` holds its own section labels in two objects at lines 7-19, where
`COPY_ZH_HK` is typed `typeof COPY_EN`. That typing means adding a key to `COPY_EN` forces it into
`COPY_ZH_HK` too, so the label cannot ship untranslated.

Add the label to `COPY_EN`:

```ts
const COPY_EN = {
  question: 'What this checks',
  whyItMatters: 'Why it matters',
  whatWeFound: 'What we found',
  status: 'Status',
  howToFix: 'How to fix',
}
```

and to `COPY_ZH_HK`:

```ts
const COPY_ZH_HK: typeof COPY_EN = {
  question: '這項檢查甚麼',
  whyItMatters: '為何重要',
  whatWeFound: '掃描發現',
  status: '狀態',
  howToFix: '如何修復',
}
```

Then insert this block immediately **before** the existing `{/* Why it matters */}` div inside the
expanded-detail container:

```tsx
          {/* What this checks */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">{c.question}</p>
            <p className="text-slate-700 leading-relaxed">{explanation.question}</p>
          </div>
```

The classes are copied verbatim from the sibling `why` block — do not introduce new tokens.

- [ ] **Step 5: Verify**

Run: `npm run lint && npm run typecheck && npm run test:unit`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -F- <<'EOF'
fix(dashboard): show check explanations in the user's locale

The dashboard result page and ScanSummary both imported CHECK_EXPLANATIONS --
the English constant -- directly rather than getCheckExplanations(locale), so a
zh-HK user saw English explanations even though the translations existed.
ResultClient was already correct.

Also renders the new `question` field, without which it would have shipped
invisible.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: A parity guard

**Files:**
- Create: `__tests__/lib/check-explanations-parity.test.ts`

Nothing in `__tests__/` currently references `CHECK_EXPLANATIONS`. A check missing from one locale, an
empty string, or a `question` that was never added would all ship silently.

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from 'vitest'
import { CHECK_EXPLANATIONS, CHECK_EXPLANATIONS_ZH_HK } from '@/lib/checkExplanations'
import { CHECK_KEYS } from '@/lib/types'

const RECORDS = [
  ['en', CHECK_EXPLANATIONS],
  ['zh-HK', CHECK_EXPLANATIONS_ZH_HK],
] as const

const FIELDS = ['question', 'why'] as const
const FIX_FIELDS = ['pass', 'warn', 'fail'] as const

describe('check explanation parity', () => {
  // The expected id list comes from lib/types.ts, NOT from
  // Object.keys(CHECK_EXPLANATIONS). Deriving the expectation from the object
  // under test makes the guard circular -- it would pass with a check missing
  // from BOTH locales, which is exactly the case worth catching.
  it.each(RECORDS)('%s has every check id with no empty field', (locale, record) => {
    const missing = CHECK_KEYS.filter(id => !(id in record))
    expect(missing).toEqual([])

    const empty: string[] = []
    for (const id of CHECK_KEYS) {
      const entry = record[id]
      if (!entry) continue
      for (const field of FIELDS) {
        if (!entry[field]?.trim()) empty.push(`${id}.${field}`)
      }
      for (const field of FIX_FIELDS) {
        if (!entry.fix?.[field]?.trim()) empty.push(`${id}.fix.${field}`)
      }
    }
    expect(empty).toEqual([])
  })

  it('both locales cover exactly the same ids', () => {
    expect(Object.keys(CHECK_EXPLANATIONS_ZH_HK).sort())
      .toEqual(Object.keys(CHECK_EXPLANATIONS).sort())
  })
})
```

**`CHECK_KEYS` does not exist yet — create it first.** `lib/types.ts` declares the check keys only as
properties of the `ScanResults` interface, so there is no runtime array to import. That interface
also contains `geoScore` and `grade`, which are not checks, so a bare `keyof ScanResults` is wrong.

Add to `lib/types.ts`, after the `ScanResults` interface:

```ts
/** The 20 check result keys, excluding ScanResults' non-check members. */
export type CheckKey = Extract<keyof ScanResults, `c${number}_${string}`>

// Record<CheckKey, true> makes the compiler reject this object if any check
// key is missing, so the array below cannot silently drift from the interface.
// Deriving it from CHECK_EXPLANATIONS instead would make the parity guard
// circular -- it must not know about the thing it checks.
const CHECK_KEY_PRESENCE: Record<CheckKey, true> = {
  c1_robots: true, c2_llms_txt: true, c3_bot_access: true, c4_structured_data: true,
  c5_extractability: true, c6_llms_full_txt: true, c7_mcp_card: true, c8_sitemap: true,
  c9_meta_desc: true, c10_headings: true, c11_faq: true, c12_canonical: true,
  c13_render: true, c14_internal_links: true, c15_entity: true, c16_freshness: true,
  c17_citation_density: true, c18_factual_density: true, c19_topical_authority: true,
  c20_chunkability: true,
}

export const CHECK_KEYS = Object.keys(CHECK_KEY_PRESENCE) as CheckKey[]
```

Verify the completeness guarantee is real: temporarily delete `c11_faq: true,` and run
`npm run typecheck`. Expected: a `TS2741`-class error naming the missing property. Restore it.

- [ ] **Step 2: Run it — expect PASS**

Run: `npx vitest run __tests__/lib/check-explanations-parity.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 3: Watch it fail**

Temporarily delete the whole `c11_faq` entry from `CHECK_EXPLANATIONS_ZH_HK`, re-run.

Expected: FAIL with `expected [ 'c11_faq' ] to deeply equal []`.

Then blank one field instead — set `c1_robots.question` to `''` in the en record — and re-run.

Expected: FAIL naming `c1_robots.question`.

Restore both. Confirm `git diff lib/checkExplanations.ts` is empty and the test passes again. A guard
nobody has watched fail is not known to work.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -F- <<'EOF'
test(checks): guard locale parity and non-empty check copy

Nothing referenced CHECK_EXPLANATIONS in __tests__/, so a check missing from one
locale or an empty field would ship silently.

The expected id list comes from lib/types.ts rather than
Object.keys(CHECK_EXPLANATIONS): deriving the expectation from the object under
test makes the guard circular, passing happily with a check absent from both
locales. Watched failing on a deleted entry and on a blanked field before being
trusted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Audit `fix.*` — report only, change nothing

**Files:**
- Create: `docs/audits/2026-09-03-check-fix-copy-audit.md`

120 strings across both locales. **Do not edit any of them.** Rewriting them is its own slice, to be
sized once this audit says how big it is.

- [ ] **Step 1: Read every `fix.pass` / `fix.warn` / `fix.fail` in both records**

Apply the same three categories: unevidenced causal claims, unevidenced magnitudes, emerging
conventions stated as requirements.

- [ ] **Step 2: Write the audit**

For each offending string record: the check id, the locale, which of `pass`/`warn`/`fail`, the
**verbatim offending phrase**, and its category. End with a count of affected strings out of 120, so
the follow-up slice can be sized rather than guessed.

Where a `fix` string is clean, do not list it. A list of everything is not an audit.

- [ ] **Step 3: Confirm nothing was edited**

Run: `git status --porcelain lib/checkExplanations.ts`
Expected: **empty.** If that file is modified, the task exceeded its scope — revert it.

- [ ] **Step 4: Commit**

```bash
git add docs/audits/ && git commit -F- <<'EOF'
docs(audit): record which fix.* strings overclaim

Report only, no copy changed. Sizes the follow-up slice instead of guessing at
it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Verify and open the pull request

- [ ] **Step 1: Full local verification**

Run: `npm run lint` — exit 0.
Run: `npm run typecheck` — exit 0.
Run: `npm run test:unit` — exit 0.

The E2E suite is unaffected by this change; skip it. If you do run it, use `CI=true` plus the fixture
env block from `.github/workflows/pr-gate.yml` — a plain local run fails ~28 tests because `npm run
dev` loads a `.env.local` whose `DATABASE_URL` password is dead, and those failures are not real.

- [ ] **Step 2: Confirm scope**

Run: `git diff --stat origin/main...HEAD`

Expected files only: `lib/checkExplanations.ts`, the three consumer files, the new test, the audit
doc, and the spec/plan docs. Anything else is scope creep — report it rather than including it.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin <branch>
```

Then open a PR whose body states: the fabricated `3×` statistic and that it shipped in both locales;
that six checks were deliberately left alone, and which; the locale bug fixed on the dashboard; and
that `fix.*` was audited but not changed, with the count from Task 5.

End the body with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 4: Verify CI ran against the right commit**

```bash
gh run list --limit 5 --json headSha,conclusion,status,workflowName
```

Compare against `git rev-parse HEAD`. **A green run whose `headSha` is not this branch's HEAD is not
evidence.** That mistake has been made in this project before.
