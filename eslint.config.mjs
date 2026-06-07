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
    // Nested build artifacts (e.g. fixtures/*/.next) must not be linted.
    "**/.next/**",
    "**/out/**",
    // Installed agent skills (third-party scripts) are not part of our source.
    ".agents/**",
  ]),
]);

export default eslintConfig;
