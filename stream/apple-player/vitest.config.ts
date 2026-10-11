import { defineConfig } from 'vitest/config';

// The player is a container rather than a package, so it has no build and nothing pnpm installs. Its
// tests follow the tree's layout anyway — a top-level tests/ beside what they test — exactly as
// `scripts/` does, and the root vitest.config.ts names this file by hand for the same reason it names
// that one: neither directory is matched by the workspace globs.
//
// What is testable here is everything that is not a browser: the signed-URL scheme (which has to
// agree with the app and the Go shim byte for byte), the end-of-record state machine, the ffmpeg
// invocation and the Chrome flags that must not drift. The browser itself is verified by running the
// container and asking `/health` and `/selftest`, which is what stream/apple-player/README.md is for.
export default defineConfig({
    test: {
        include: ['./tests/**/*.test.ts'],
    },
});
