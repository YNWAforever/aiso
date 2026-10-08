# Dependency remediation review — 2026-10-09

The root production audit now reports **zero findings**. The complete root graph retains **five high findings from one unpatched development lint dependency chain (F37)**. The separate Worker graph reports **zero findings in both full and production scopes**. All counts below are package advisory entries, not demonstrated application exploits.

This review covers local source and dependencies starting from `55fcabfe3cbfe1cf220c136897252a595c8521fa`. It does not establish the version or security state of the hosted Neon Auth service or any deployed application. No hosted Auth, credentials, database, email, bindings, schedules, or deployment were changed.

## Graph inventory and audit receipts

The tracked manifest/lock inventory contains exactly two independent npm projects: the repository root and `cloudflare/cron-worker/`. Both were audited. Raw receipts are retained under `artifacts/audit-20261009/`.

| Graph and scope | Result | npm metadata: total; production; development | Receipt |
| --- | --- | --- | --- |
| Root baseline, production | 17: 2 critical, 5 high, 10 moderate | 778; 320; 342 | `production-dependency-audit.json` |
| Root final, production | 0; native exit 0 | 816; 328; 374 | `production-dependency-audit-clean-ci.json` |
| Root final, all dependencies | 5 high; native exit 1 | 816; 328; 374 | `full-dependency-audit-clean-ci.json` |
| Worker baseline, all dependencies | 5 high | 160; 1; 160 | `cron-worker-dependency-audit.json` |
| Worker final, production | 0; native exit 0 | 160; 1; 160 | `worker-production-audit-clean-ci.json` |
| Worker final, all dependencies | 0; native exit 0 | 160; 1; 160 | `worker-full-audit-clean-ci.json` |

These are npm's reported graph inventory fields. `--omit=dev` changes the audited scope but still reports the full lock's inventory metadata. Optional/peer categories overlap other classifications and must not be added to form a different denominator. The Worker declares only development dependencies; its production count of one includes the project itself. Graphs are independent, so their inventories are not a deduplicated application package count.

Vitest/Vite appeared in the original root production audit because Better Auth 1.4.18 declared Vitest as an optional peer. The original lock and local `npm explain` showed a production path through the Auth SDK and marked Vitest `devOptional`. This did not demonstrate a public Vitest/Vite service running in the application.

## Applied root updates (F36)

| Direct package | Before | Final manifest version | Reason |
| --- | --- | --- | --- |
| `next` | `16.2.4` | `16.3.8` exact | Fixed 16.x framework release covering the audited advisories. |
| `eslint-config-next` | `16.2.4` | `16.3.8` exact | Keep the supported framework/lint pair aligned. |
| `@neondatabase/auth` | `0.4.2-beta` exact | `0.5.0-beta` exact | Official SDK upgrade to Better Auth 1.6.23 and auth-ui 0.3.0-beta. |
| `resend` | `^6.12.2` | `6.12.3` exact | Uses patched svix 1.92.2/uuid 11.1.1. |
| `vitest` | `^4.1.5` | `4.1.11` exact | Fixes the audited redirect-mock file-read advisory. |
| `@vitest/coverage-v8` | `^4.1.5` | `4.1.11` exact | Matches the Vitest peer contract. |

Eligible transitive refreshes remain within their existing supported ranges: sharp 0.35.5; PostCSS 8.5.23 and 8.5.29 on their respective paths; source-map-js 1.2.2; nanoid 3.3.20 and 5.1.16 on their respective paths; Vite 8.3.4; baseline-browser-mapping 2.11.28; Babel core 7.29.7; brace-expansion 1.1.21 and 5.0.12; browserslist 4.29.3; and js-yaml 4.3.2. No forced audit repair or unrelated major upgrade was applied.

The first post-upgrade full audit contained nine findings (eight high, one low). Compatible development dependency refreshes removed the Babel, brace-expansion, browserslist, and js-yaml entries; F37 is the remaining chain. Earlier audit receipts remain preserved as intermediate results.

## Neon compatibility and scoped pins

The published SDK archive was inspected before installation. The application still uses supported `@neondatabase/auth/next` and `@neondatabase/auth/next/server` exports, including `createAuthClient`, `createNeonAuth`, handler methods, and middleware. It does not import the deprecated UI entrypoints or require a local schema migration for this SDK update.

An initial npm resolution exposed a packaging mismatch: auth-ui 0.3.0-beta brings `@daveyplate/better-auth-ui` 3.4.0, whose broad ranges selected Better Auth API-key/core 1.7.7 and incompatible fetch peers. The [publisher's root manifest](https://github.com/neondatabase/neon-js/blob/main/package.json) supplies pnpm overrides for its intended coherent graph. npm does not inherit a dependency repository's pnpm overrides.

The root manifest therefore reproduces those eight publisher pins inside an override scoped to **`@neondatabase/auth@0.5.0-beta`**:

| Package | Pin |
| --- | --- |
| `better-auth`, `@better-auth/core`, `@better-auth/passkey`, `@better-auth/telemetry`, `@better-auth/api-key` | `1.6.23` |
| `@better-auth/utils` | `0.4.2` |
| `@better-fetch/fetch` | `1.3.1` |
| `better-call` | `1.3.7` |

The ninth scoped pin, `@hookform/resolvers` 5.4.0, preserves the previously installed version within auth-ui's `^5.2.2` range and its UI peer contract. The incidental 5.9.1 resolution added an optional AJV 8 peer that conflicted with the existing AJV 6 lint dependency. The application does not need that new resolver/validator integration. This pin is a baseline compatibility choice, separate from the eight publisher Auth pins. Review all nine together on the next SDK update.

The initial install warnings and failed peer-tree checks are retained. A subsequent incremental install left a stale nested resolver node despite the new override; only those generated resolver lock entries were re-resolved by npm. The final clean install from the resulting lock passed, and fresh `npm ls --all` returned exit 0 with no dependency problems. No peer-check suppression was used.

The SDK accepts canonical `__Secure-neon-auth.session_challenge` and legacy `__Secure-neon-auth.session_challange` cookies. The application proxy now recognizes both. It still requires the verifier and excludes popup completion from server exchange, preserving the opener/client flow. Regression coverage exercises delegation, a challenge without a verifier, and both locale popup paths for each spelling.

The existing `disableCookieCache=true` handling for verifier exchange remains necessary because the inspected SDK checks signed cookie cache first. Existing response `content-encoding` stripping remains necessary because the SDK forwards that header after Node fetch decodes upstream bodies. No-store, detached RSC session validation, renewal suppression, and cookie-clearing checks remain intact. SDK defaults include Secure/SameSite=Lax cookies. These local contracts do not establish hosted sign-in, renewal, revocation, or tenant acceptance.

Public source snapshots are retained in `dependency-review/neon-upstream-package.json`, `neon-auth-upstream-changelog.md`, and the published `neon-auth-0.5.0-beta.tgz` with its extracted source. The upstream changelog grouped the new changes under Unreleased, so behavior was checked against the actual published archive.

## Separate Worker remediation

The Worker keeps its independent toolchain and existing runtime configuration. Its direct Wrangler dependency moves from resolved 4.125.0 to **4.149.0 exact**. `@cloudflare/workers-types` moves from resolved 5.20260822.1 to **5.20261006.1 exact**, satisfying Wrangler's matching peer range. Both remain within the existing declared majors. Wrangler requires Node >=22; validation used Node 24.18.0/npm 11.16.0.

Wrangler's official Miniflare 5.20261006.1-alpha dependency pins **sharp 0.35.5** and **undici 7.29.1**. Source-map-js was refreshed from 1.2.1 to **1.2.2** within its existing PostCSS range. The [Wrangler 4.149.0 release](https://github.com/cloudflare/workers-sdk/releases/tag/wrangler@4.149.0) explicitly includes the sharp patch. Earlier candidates still pinned affected sharp versions; no Worker overrides were necessary. Vitest 4.1.11, Vite 8.2.2, and TypeScript 5.9.3 remain on their previously locked versions.

Published metadata is retained in `dependency-review/wrangler-4.149.0-metadata.json` and `miniflare-5.20261006.1-alpha-metadata.json`. No configuration, compatibility date, schedule, binding, or Worker source changes were made by this dependency remediation. Its tests replace fetch with local fixtures; they do not trigger a real cron or provider operation.

## F37 — unpatched development lint dependency

The remaining advisory is [GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). Braces through 3.0.3 can exhaust the stack while processing deeply nested brace patterns. The reviewed advisory lists **no patched version**. The five high package entries are the one development chain:

`eslint-config-next@16.3.8 → @next/eslint-plugin-next@16.3.8 → fast-glob@3.3.1 → micromatch@4.0.8 → braces@3.0.3`

All five lock entries are development-only. The inspected plugin's `dist/utils/get-root-dirs.js` passes `settings.next.rootDir` to fast-glob when that setting is supplied; otherwise it uses `context.cwd` directly. The current ESLint configuration does not set `next.rootDir`. Local source review found no direct imports of this chain in application routes, libraries, components, or scripts. The plausible impact here is interruption of development/CI tooling if an affected glob call receives an attacker-controlled deeply nested pattern. Installed package presence does not establish a vulnerable live route or a runtime exploit.

Public registry readback on **2026-10-09** confirms `braces@latest` is still 3.0.3 and `micromatch@latest` is 4.0.8 with `braces: ^3.0.3`. Even the current `@next/eslint-plugin-next@latest` 16.4.0 still pins fast-glob 3.3.1. Read-only receipts are `dependency-review/braces-latest-metadata.json`, `micromatch-latest-metadata.json`, and `next-eslint-latest-metadata.json`. These dated registry observations, together with the advisory's explicit lack of a patch, establish the present upstream limitation.

npm proposes downgrading `eslint-config-next` to 14.2.35, a semver-major change that would break the supported framework/lint pairing. That suggestion was not applied. The finding remains open pending a supported upstream fix; it is neither suppressed nor marked fixed by the clean production audit.

## Verification and evidence

| Check | Native result | Evidence |
| --- | --- | --- |
| Canonical-cookie regression before proxy repair | Exit 1: 25 tests, 24 passed, one intended failure | `dependency-proxy-red.json` / `.log` |
| Installed SDK/Auth/proxy focused regression | Exit 0: 115/115 tests across nine files | `dependency-auth-green.json` / `.log` |
| Final root clean install, scripts disabled | Exit 0; 684 packages installed | `dependency-clean-ci.log` |
| Final root dependency tree | Exit 0; no problems | `dependency-tree-clean-ci.json` / `.stderr.log` |
| Final Worker clean install, scripts disabled | Exit 0; 79 packages installed | `worker-clean-ci.log` |
| Final Worker dependency tree | Exit 0; no problems | `worker-dependency-tree-clean-ci.json` / `.stderr.log` |
| Worker scheduled-handler and config contract tests | Exit 0: 8/8 tests, one file | `worker-security-tests.json` / `.log` |
| Worker TypeScript | Exit 0 | `worker-security-typecheck.log` |

The focused Auth receipt predates the final compatible development refresh; the final root full-suite/static/build checks are recorded separately in the continuation verification receipt. Root and Worker lockfiles were frozen after their respective clean installs. Root install deprecation notices for existing React Email packages remain distinct from peer problems or audit findings. The earlier `dependency-tree-after.json`, `dependency-tree-final.json`, and `dependency-peers-reconciled.json` are failed intermediate verifications, not final pass receipts.

Final lock SHA-256:

- Root: `9abb5727eb4fc9116172c3eb83e4cfc4415432d30e35d59559beb88f94707a5c`.
- Worker: `b4191f7f2f0ec42f98ca9707e2f7c1c4f76adf9b403c6e5e8903911018153700`.

Active setup/architecture guidance was updated in `CLAUDE.md`, ADR-004, and ADR-009. Dated historical plans and evidence were preserved. Final full-application validation and outstanding hosted/release gates are reported in [the continuation audit](./continuation-audit.md).

## Primary advisory and compatibility sources

- [Next.js 16.3.8 release](https://github.com/vercel/next.js/releases/tag/v16.3.8) and [ImageResponse advisory](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j).
- [Sharp librsvg advisory](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w) and [PostCSS source-map advisory](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp).
- [Better Auth magic-link/email-OTP advisory](https://github.com/better-auth/better-auth/security/advisories/GHSA-qq9h-g4jm-xgf3), [Neon publisher manifest](https://github.com/neondatabase/neon-js/blob/main/package.json), and [Neon SDK changelog](https://github.com/neondatabase/neon-js/blob/main/packages/auth/CHANGELOG.md).
- [Vitest redirect-mock advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9) and [Vite Windows file-access advisory](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff).
- [Babel advisory](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8), [brace-expansion advisory](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [browserslist advisory](https://github.com/advisories/GHSA-c83g-rgw3-j3cx), and [js-yaml advisory](https://github.com/advisories/GHSA-2883-xcg3-v3hh).
- [Undici TLS validation advisory](https://github.com/nodejs/undici/security/advisories/GHSA-w293-vg96-wgc3), [source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), [Wrangler release](https://github.com/cloudflare/workers-sdk/releases/tag/wrangler@4.149.0), and [Cloudflare install/update guidance](https://developers.cloudflare.com/workers/wrangler/install-and-update/).
- [Remaining braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). The complete per-package advisory list is preserved in each raw audit receipt.
