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
