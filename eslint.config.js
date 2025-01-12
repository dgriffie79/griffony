import globals from "globals";
import pluginJs from "@eslint/js";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    files: ['src/**/*.js'],
    ignores: ['/*.config.js'],
    languageOptions: { globals: globals.browser },
  },
  pluginJs.configs.recommended,
];