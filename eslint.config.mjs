import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Files that still legitimately import the dead Supabase clients, pending their
// migration to db() in the remaining slices. This list must only ever shrink;
// when it is empty, delete it along with lib/supabase.ts and
// lib/supabase-server.ts and uninstall @supabase/ssr and @supabase/supabase-js.
// See docs/superpowers/specs/2026-07-26-critical-path-to-production-design.md
//
// NOTE: these are globs, so Next.js dynamic segments need their brackets
// escaped. An unescaped [lang] is a character class matching one of l/a/n/g,
// so it silently never matches the literal directory and the rule fires anyway.
const SUPABASE_MIGRATION_DEBT = [
  // Fenced feature; its routes return 503 but the dashboard page still imports
  // the store. Migrate when Local Trust is unfenced.
  "lib/localTrust/store.ts",
  // The shims themselves — they exist only to keep the files above compiling.
  "lib/supabase.ts",
  "lib/supabase-server.ts",
];

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
    // The Supabase project backing this app was deleted and its hostname no
    // longer resolves. supabase-js does not throw on a dead host — it resolves
    // to { data: null, error } — so a new import here fails silently in
    // production rather than loudly in review.
    files: [
      "app/**/*.{ts,tsx}",
      "lib/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
      "scripts/**/*.{ts,tsx}",
    ],
    ignores: SUPABASE_MIGRATION_DEBT,
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
]);

export default eslintConfig;
