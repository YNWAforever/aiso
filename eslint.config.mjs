import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // The repo already writes `_baseUrl` / `_context` / `_req` for parameters a
    // signature requires but the body does not use — nine of them, all
    // deliberate. Nothing told ESLint that, so they were reported alongside
    // genuinely dead code and the real findings hid in the noise. Honour the
    // convention so an unused name that is NOT underscore-prefixed means
    // something is actually wrong.
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // The Supabase project backing this app was deleted and its hostname no
    // longer resolves. supabase-js does not throw on a dead host — it resolves
    // to { data: null, error } — so a new import here fails silently in
    // production rather than loudly in review.
    // Includes .mjs/.js/.cjs deliberately. Scoped to {ts,tsx}, this rule never
    // read scripts/run-pulse.mjs, which imported @supabase/supabase-js the whole
    // time the rule was supposedly preventing exactly that.
    files: [
      "app/**/*.{ts,tsx,mjs,js,cjs}",
      "lib/**/*.{ts,tsx,mjs,js,cjs}",
      "components/**/*.{ts,tsx,mjs,js,cjs}",
      "scripts/**/*.{ts,tsx,mjs,js,cjs}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@supabase/*"],
              message:
                "The Supabase project is deleted. Use db() from @/lib/db (tagged templates only).",
            },
            {
              group: ["@/lib/supabase", "@/lib/supabase-server"],
              message:
                "These shims point at a deleted project. Use db() from @/lib/db (tagged templates only).",
            },
          ],
        },
      ],
    },
  },
  {
    // A check that reaches the network with the global fetch bypasses
    // lib/security/public-url.ts entirely: no DNS pinning, and redirects are
    // followed with no revalidation, so a 302 to 169.254.169.254 lands. Every
    // check takes a PublicUrlFetch precisely so the scan route can inject the
    // guarded one — checkMcpCard silently did not, which is the bug this rule
    // exists to stop recurring.
    files: ["lib/checks/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message:
            "Checks must use the injected PublicUrlFetch. Bare fetch() skips the SSRF boundary in lib/security/public-url.ts and follows redirects unvalidated.",
        },
      ],
    },
  },
]);

export default eslintConfig;
