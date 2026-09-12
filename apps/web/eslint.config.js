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
        // Mantine's clipboard copies only through `navigator.clipboard`, which a station opened over
        // plain HTTP on its own network does not have, and fails silently there. The console's own
        // `CopyButton` falls back and says when it cannot; see `src/components/shared/clipboard.ts`.
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: '@mantine/core',
                            importNames: ['CopyButton'],
                            message: "Use CopyButton from 'components/shared/copy.button', which works over plain HTTP.",
                        },
                        {
                            name: '@mantine/hooks',
                            importNames: ['useClipboard'],
                            message: "Use copyText from 'components/shared/clipboard', which works over plain HTTP.",
                        },
                    ],
                },
            ],
        },
    },
    {
        // TanStack Router codegen — rewritten wholesale on every dev/build run.
        ignores: ['src/routeTree.gen.ts'],
    },
];
