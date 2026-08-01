//  @ts-check

import base from '@repo/config-eslint/base.js';

/** @type {import("eslint").Linter.Config[]} */
export default [
    ...base,
    {
        // contractkit codegen output — see .contractkit/cache/typescript-manifest.json for the
        // authoritative list. `pnpm build:contracts` rewrites these wholesale, so hand-fixing a
        // lint warning here (unused re-exports, unused `*Base` schemas) doesn't survive a regen.
        ignores: [
            'src/modules/*/types/**',
            'src/routes/authentication.factor.router.ts',
            'src/routes/authentication.router.ts',
            'src/routes/authentication.sessions.router.ts',
            'src/routes/engine.router.ts',
            'src/routes/music.router.ts',
            'src/routes/render.router.ts',
            'src/routes/setup.router.ts',
            'src/routes/stream.router.ts',
        ],
    },
];
