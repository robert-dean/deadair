//  @ts-check

import i18next from 'eslint-plugin-i18next';

/**
 * The folders whose copy has been moved into `src/i18n/` catalogs. Each extraction adds its folder
 * here; once every folder is listed the list becomes `src/**`.
 */
export const TRANSLATED = [
    'src/components/shared/**',
    'src/components/shell/**',
    'src/components/auth/**',
    'src/components/login.page.tsx',
    'src/routes/**',
    'src/components/onboarding/**',
    'src/components/personas/**',
    'src/components/settings/**',
    'src/components/plugins/**',
    'src/components/topics/**',
    'src/components/catalog/**',
    'src/components/library/**',
];

/**
 * Words an operator reads go through `t()`, not into JSX as literals.
 *
 * `jsx-only` checks JSX text and the literals inside JSX, and the attribute list confines it to the
 * props that carry copy: `variant="light"` is a value, `label="Save"` is a sentence. A string handed
 * to a helper outside JSX (`notifySaved('…')`) or a default parameter is not caught, so a review
 * still has to look for those.
 *
 * Shared between `eslint.config.js` and `tests/i18n/literal.strings.test.ts`, because the lint
 * config only warns and nothing in CI runs it: the test is what actually refuses a literal.
 *
 * @type {import('eslint').Linter.Config}
 */
export const literalStrings = {
    files: TRANSLATED,
    plugins: { i18next },
    rules: {
        'i18next/no-literal-string': [
            'error',
            {
                mode: 'jsx-only',
                'should-validate-template': true,
                // The rule's own defaults, plus the calls whose string arguments are names rather than
                // words: `form.getInputProps('email')` inside a spread attribute is a field key.
                callees: {
                    exclude: [
                        'i18n(ext)?',
                        't',
                        'require',
                        'addEventListener',
                        'removeEventListener',
                        'postMessage',
                        'getElementById',
                        'dispatch',
                        'commit',
                        'includes',
                        'indexOf',
                        'endsWith',
                        'startsWith',
                        'getInputProps',
                        'setFieldValue',
                        'insertListItem',
                        'removeListItem',
                    ],
                },
                'jsx-attributes': {
                    include: [
                        'label',
                        'title',
                        'placeholder',
                        'description',
                        'aria-label',
                        'alt',
                        'confirmLabel',
                        'closeButtonLabel',
                        'errorTitle',
                        'errorFallback',
                        'fallback',
                        'message',
                        'eyebrow',
                        'tooltip',
                        'nothingFoundMessage',
                    ],
                },
                // Punctuation, symbols and figures on their own (a middle dot between two values, an
                // arrow, a unit sign) are layout, not copy; so is an all-capitals token like `LUFS`.
                words: { exclude: [/^[\p{P}\p{S}\p{N}\s]+$/u, /^[A-Z_-]+$/] },
            },
        ],
    },
};
