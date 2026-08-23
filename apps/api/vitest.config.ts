import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (path: string): string => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

// Tests live in a top-level tests/ folder mirroring src/, importing ../src/...
// Kept out of the build tsconfig so tsc only type-checks shippable src.
export default defineConfig({
    resolve: {
        // Mirrors tsconfig.json's "paths": tsc only type-checks these, it never
        // rewrites the emitted specifiers. At runtime package.json#imports maps
        // them (to `dist/` by default, to `src/` under the `development`
        // condition); vitest's esbuild-based transform reads neither, so the
        // mapping is spelled out here as well.
        alias: [
            { find: '#src', replacement: src('') },
            { find: '#routes', replacement: src('routes') },
            { find: '#modules', replacement: src('modules') },
        ],
    },
    test: {
        include: ['./tests/**/*.test.ts'],
    },
});
