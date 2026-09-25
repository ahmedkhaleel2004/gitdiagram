import nextCoreVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextCoreVitals,
  ...nextTypescript,
  {
    // eslint-plugin-react's version auto-detection calls context.getFilename,
    // which ESLint 10 removed. The same removal crashes the
    // react/forward-ref-uses-ref and react/jsx-filename-extension rules, so
    // leave those off until eslint-plugin-react supports ESLint 10.
    settings: { react: { version: "19.3" } },
  },
  {
    ignores: [
      ".next/**",
      ".claude/**",
      ".agents/**",
      ".playwright-mcp/**",
      "tmp/**",
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "next-env.d.ts",
      "public/video-engine/assets/**",
      "workers/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
        },
      ],
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/require-await": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // The video engine: plain browser scripts, loaded by stage.html.
    files: ["public/video-engine/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        getComputedStyle: "readonly",
        setTimeout: "readonly",
        URLSearchParams: "readonly",
        Promise: "readonly",
        gsap: "readonly",
      },
    },
    rules: { "no-undef": "error" },
  },
];

export default config;
