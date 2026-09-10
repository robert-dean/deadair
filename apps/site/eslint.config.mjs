//  @ts-check

import { config } from '@repo/config-eslint/react-internal.js';

/** @type {import("eslint").Linter.Config[]} */
export default [
    ...config,
    {
        // eslint-plugin-react's `detect` crashes under ESLint 10, so the version is pinned here.
        settings: { react: { version: '19.2' } },
    },
    {
        // Docusaurus's generated route and config modules, and the build.
        ignores: ['.docusaurus/**', 'dist/**'],
    },
];
