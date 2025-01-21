import globals from "globals"
import pluginJs from "@eslint/js"
import jsdoc from 'eslint-plugin-jsdoc'

/** @type {import('eslint').Linter.Config[]} */
export default [
  jsdoc.configs['flat/recommended'],
  {
    rules: {
      'jsdoc/require-param-description': 'off',
      'jsdoc/require-returns-description': 'off',
      'jsdoc/require-jsdoc': 'off',
    },
  },
  pluginJs.configs.recommended,
  {
    files: ['src/**/*.js'],
    plugins: {
      jsdoc,
    },
    ignores: ['/*.config.js'],
    languageOptions: {
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: "latest",
      },
      globals: globals.browser
    },
  },
]