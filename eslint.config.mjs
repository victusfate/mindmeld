// Scaffold's own ESLint config — dogfoods the type-aware linter we ship to
// consumers (lib/linters/ts/eslint.config.mjs), so our tooling is held to the
// same bar. Scaffold's source is now TypeScript (.ts, run via Node's native
// type-stripping), so the type-aware `ts` variant is the right fit.
//
// Unlike the shipped template (which ignores tools/**), scaffold *wants* to lint
// its own tools/ and scripts/ — that's the whole point of dogfooding. The root
// tsconfig.json includes exactly those paths so projectService can build a
// program for every linted file.
//
// lib/linters/** is ignored: those are template configs, not source — the JS
// and TS templates are themselves flat-config files that would otherwise be
// discovered as nested configs and confuse ESLint's config resolution.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const MAX_COMPLEXITY = 10;
const MAX_PARAMS = 4;

export default tseslint.config(
  // .tooling/** is untracked local tooling (the security scanners' venv and ESLint stack); .claude/worktrees/**
  // holds subagent worktrees, which are other checkouts of this repo. fixtures/** are studied (untrusted) sample
  // repositories for Mind Meld Studio tests, deliberately containing a secret and a prompt-injection string.
  { ignores: ['lib/linters/**', 'fixtures/**', '**/*.scaffold-new', 'node_modules/**', '.tooling/**', '.claude/worktrees/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Rubric thresholds ESLint owns: they need the AST, which the mechanical
      // check can't parse. Errors, not warnings — existing violations are frozen
      // in eslint-suppressions.json and may only shrink (prune when fixed).
      'max-params': ['error', MAX_PARAMS],
      'complexity': ['error', MAX_COMPLEXITY],
      // File length and magic numbers belong to scripts/check-quality-mechanical.sh,
      // which honors `quality-ok:` pragmas and test-file exclusions. Duplicating
      // them here only produced unfixable noise that disagreed with the gate.
      'max-lines': 'off',
      'no-magic-numbers': 'off',
      // See lib/linters/ts/eslint.config.mjs — autofix strips assertions tsc needs.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
  {
    // Mind Meld Studio package tests: node:test's test() returns a promise the runner awaits, and HTTP
    // assertions read untyped JSON responses on purpose.
    files: ['packages/*/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Config and plain-JS files aren't part of the TS program.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },
);
