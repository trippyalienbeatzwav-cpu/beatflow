// Flat ESLint config: Node for the server, scripts and tests; browser globals for the front end.
import js from "@eslint/js";
import globals from "globals";

const shared = {
  "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
  "no-empty": ["error", { allowEmptyCatch: true }],
  eqeqeq: ["error", "smart"],
  "no-var": "error",
  "prefer-const": ["error", { destructuring: "all", ignoreReadBeforeAssign: true }],
};

export default [
  { ignores: ["node_modules/**", "dist/**", "test-results/**", "server/data/**", "assets/**"] },
  js.configs.recommended,
  {
    files: ["server/**/*.js", "scripts/**/*.mjs", "tests/**/*.js", "eslint.config.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...globals.node } },
    rules: shared,
  },
  {
    files: ["js/**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "script", globals: { ...globals.browser, BF: "writable", TBDSP: "readonly", TBSynth: "readonly" } },
    rules: { ...shared, "no-cond-assign": ["error", "except-parens"] },
  },
  {
    files: ["js/music/dsp.js", "js/music/synth.js", "tests/fixtures/*.js"],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.worker } },
  },
  // E2E tests pass functions into the page (page.evaluate), so browser globals are legitimate there
  { files: ["tests/e2e/**/*.js"], languageOptions: { globals: { ...globals.node, ...globals.browser, BF: "readonly" } } },
  // Seed catalog files are evaluated in a vm context that provides BF (see server/seed-data/catalog.js)
  { files: ["server/seed-data/*-catalog.js"], languageOptions: { globals: { BF: "writable" } } },
  { files: ["js/music/analyzer.worker.js"], languageOptions: { globals: { ...globals.worker, TBDSP: "readonly" } } },
];
