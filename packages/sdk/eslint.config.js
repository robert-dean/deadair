//  @ts-check

import base from '@repo/config-eslint/base.js';

/** @type {import("eslint").Linter.Config[]} */
export default [
    ...base,
    {
        // Everything under `src/` except `sdk-options.ts` is written by `pnpm build:contracts` from
        // the `.ck` files, and `lint` is `eslint --fix`, so a lint run EDITS generator output.
        //
        // That is not a style question, it is a loop. contractkit emits `export interface X extends
        // Y {}` for an input type that adds no fields; `no-empty-object-type` rewrites it to `export
        // type X = Y`; and CI's `generated` job regenerates cold and fails on the difference. So
        // whoever ran `pnpm lint` last before committing decided whether the build was red, and the
        // fix looked like a formatting nit rather than the standing conflict it was. `TrackRowInput`
        // sat in the eslint-normalised form from 2026-08-16.
        //
        // Turned off rather than the whole directory ignored, because the other rules still catch
        // something worth catching in a client nobody reads, and because a broad ignore would also
        // cover `sdk-options.ts`, which is the one file here a person actually wrote.
        files: ['src/**/*.ts'],
        ignores: ['src/sdk-options.ts'],
        rules: {
            '@typescript-eslint/no-empty-object-type': 'off',
            '@typescript-eslint/no-empty-interface': 'off',
        },
    },
];
