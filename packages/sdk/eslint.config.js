//  @ts-check

import base from '@repo/config-eslint/base.js';

/** @type {import("eslint").Linter.Config[]} */
export default [
    ...base,
    {
        // The whole of `src/` is written by `pnpm build:contracts` from the `.ck` files, and `lint`
        // is `eslint --fix`, so a lint run EDITS generator output.
        //
        // That is not a style question, it is a loop. contractkit emits `export interface X extends
        // Y {}` for an input type that adds no fields; `no-empty-object-type` rewrites it to `export
        // type X = Y`; and CI's `generated` job regenerates cold and fails on the difference. So
        // whoever ran `pnpm lint` last before committing decided whether the build was red, and the
        // fix looked like a formatting nit rather than the standing conflict it was. `TrackRowInput`
        // sat in the eslint-normalised form from 2026-08-16.
        //
        // `sdk-options.ts` USED to be excepted here, on the belief that it was the one file in this
        // directory a person wrote. It is not: it is in contractkit's own manifest, and an edit to
        // it is reverted by the next `pnpm build:contracts`. That was measured rather than reasoned
        // — changing its two `any`s to `unknown` survived exactly until the next codegen run — so
        // the exception is gone and the `any`s it emits are off with everything else here. Fixing
        // those properly means fixing the GENERATOR, not this tree.
        //
        // Rules off rather than the directory ignored, because the ones left still catch something
        // worth catching in a client nobody reads.
        files: ['src/**/*.ts'],
        rules: {
            '@typescript-eslint/no-empty-object-type': 'off',
            '@typescript-eslint/no-empty-interface': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },
];
