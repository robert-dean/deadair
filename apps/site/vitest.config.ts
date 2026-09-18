import { defineConfig } from 'vitest/config';

// Tests live in a top-level tests/ folder mirroring src/, importing ../src/...
// Kept out of the build tsconfig so tsc only type-checks what the site ships.
export default defineConfig({
    test: {
        include: ['./tests/**/*.test.ts'],
    },
});
