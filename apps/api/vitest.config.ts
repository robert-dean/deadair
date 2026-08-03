import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (path: string): string => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

// Tests live in a top-level tests/ folder mirroring src/, importing ../src/...
// Kept out of the build tsconfig so tsc only type-checks shippable src.
export default defineConfig({
    resolve: {
        // Mirrors tsconfig.json's "paths": tsc only type-checks these, it never
        // rewrites the emitted specifiers, so the runtime needs its own mapping.
        // `@swc-node/register` (used by the `dev` script) resolves these via
        // tsconfig natively; vitest's esbuild-based transform does not, so it is
        // spelled out here instead.
        alias: [
            { find: '#src', replacement: src('') },
            { find: '#routes', replacement: src('routes') },
            { find: '#modules', replacement: src('modules') },
            { find: '#shared', replacement: src('shared') },
        ],
    },
    test: {
        include: ['./tests/**/*.test.ts'],
    },
});
