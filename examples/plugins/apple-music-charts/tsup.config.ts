import { defineConfig } from 'tsup';

// One ES module the station imports. What is left OUT of it matters more than what is in it:
//
// - Anything under `peerDependencies` is external automatically. That is the SDK and zod, and they
//   must stay out, because the station hands every plugin its own copy of each. A class you extend
//   has to be the class the station checks against.
// - Anything else you import and list under `devDependencies` is bundled in, which is how a plugin
//   carries a library of its own without shipping a `node_modules`. Do not use `dependencies` for
//   one: tsup treats those as external too, and the station will not install them for you.
// - `noExternal` beats `external` if a name is ever in both, so reach for it only to force a library
//   into the bundle, never for the SDK or zod.
export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    target: 'node24',
    sourcemap: true,
    clean: true,
});
