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
        // TanStack Router codegen — rewritten wholesale on every dev/build run.
        ignores: ['src/routeTree.gen.ts'],
    },
];
