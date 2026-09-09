import js from '@eslint/js';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';
import turboPlugin from 'eslint-plugin-turbo';
import tseslint from 'typescript-eslint';
import onlyWarn from 'eslint-plugin-only-warn';

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export default [
    js.configs.recommended,
    eslintConfigPrettier,
    ...tseslint.configs.recommended,
    {
        plugins: {
            turbo: turboPlugin,
        },
        rules: {
            'turbo/no-undeclared-env-vars': 'warn',
        },
    },
    {
        plugins: {
            onlyWarn,
        },
    },
    {
        // Plain JavaScript in this repository is Node: watchers, probes and build scripts. Nothing
        // declared Node's globals for them, so `no-undef` — which `js.configs.recommended` turns on
        // — reported `process`, `setTimeout` and `clearTimeout` as undefined, about twenty times in
        // two files. TypeScript files never showed it because `tseslint`'s eslint-recommended block
        // switches `no-undef` off for them, on the grounds that the compiler already answers that
        // question; that is also why this is scoped to the extensions the compiler does not see.
        //
        // The React config carries the same block for its own `scripts/**` and has since a favicon
        // generator hit this; the difference is that it needs the narrower scope, because its other
        // files really are browser code.
        files: ['**/*.{js,mjs,cjs}'],
        languageOptions: { globals: { ...globals.node } },
    },
    {
        rules: {
            // `_`-prefixed means "deliberately unused" — for locals (omit-by-rest destructuring)
            // just as much as for args, so the two patterns stay in step.
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-empty-object-type': 'warn',
            '@typescript-eslint/no-empty-interface': 'warn',
            '@typescript-eslint/no-empty-object-type': 'warn',
        },
    },
    {
        ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'bin/**', 'tests/**'],
    },
];
