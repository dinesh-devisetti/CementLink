import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  { ignores: [".next/**", ".next-e2e/**", "node_modules/**", "coverage/**", "drizzle/**", "playwright-report/**", "test-results/**", ".claude-flow/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default config;
