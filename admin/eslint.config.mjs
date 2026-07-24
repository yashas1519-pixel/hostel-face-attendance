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
    rules: {
      // setState in useEffect is valid for auth guards and route sync
      "react-hooks/set-state-in-effect": "off",
      // Function declarations are hoisted — void init() before async function init() is valid JS
      "no-use-before-define": "off",
      "@typescript-eslint/no-use-before-define": "off",
      "react-hooks/immutability": "off",
    },
  },
]);

export default eslintConfig;
