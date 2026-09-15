//  @ts-check

import base from '@repo/config-eslint/base.js';

/** @type {import("eslint").Linter.Config[]} */
export default [
    ...base,
    {
        // The plugin folder holds the built bundle and the property inspector's vendored script.
        ignores: ['radio.deadair.streamdeck.sdPlugin/**', 'artifacts/**'],
    },
];
