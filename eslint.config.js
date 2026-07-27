import prettier from 'eslint-config-prettier';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import svelteConfig from './svelte.config.js';

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

/** @type {import('eslint').Linter.Config[]} */
export default [
  includeIgnoreFile(gitignorePath),
  {
    // Ignore auto-generated paraglide files
    ignores: ['src/lib/paraglide/**', 'src/paraglide/**']
  },
  js.configs.recommended,
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      // Allow unused variables/args prefixed with underscore
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ]
    }
  },
  {
    files: ['**/*.svelte', '**/*.svelte.js'],
    languageOptions: { parserOptions: { svelteConfig } },
    rules: {
      // Disable until base path support is needed — widespread pre-existing violations
      'svelte/no-navigation-without-resolve': 'off'
    }
  },
  {
    files: ['src/**/*.{js,svelte}'],
    ignores: ['src/lib/cordn/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['ts-mls', 'ts-mls/*', '@contextvm/*', '@noble/ciphers', '@noble/ciphers/*'],
              message:
                'Import Cordn APIs via $lib/cordn only (spike wrapper isolates the MLS stack).'
            }
          ]
        }
      ]
    }
  }
];
