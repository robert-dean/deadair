import { writeFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const bin = 'radio.deadair.streamdeck.sdPlugin/bin';

// One ES module the Stream Deck app runs with its own Node, and this is the reverse of the example
// plugin's `tsup.config.ts`: that one must leave the SDK OUT because the station hands it a copy,
// where nothing hands this one anything. The packed plugin ships without a `node_modules`, so every
// import is inlined, the station's SDK and its luxon included, and `noExternal` says so whatever
// section of package.json a dependency is listed in. Node's own modules stay external on their own.
export default defineConfig([
    {
        entry: { plugin: 'src/plugin.ts' },
        format: ['esm'],
        platform: 'node',
        target: 'node24',
        outDir: bin,
        noExternal: [/.*/],
        // `ws` reaches for these two native accelerators inside a try and runs without them.
        external: ['bufferutil', 'utf-8-validate'],
        // `ws` is CommonJS and calls `require('events')`, which an ES module does not have. esbuild
        // leaves those calls in place, so the bundle gives itself one.
        banner: { js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);" },
        sourcemap: false,
        clean: true,
        // The manifest names `bin/plugin.js`, and Node reads it as an ES module only because of this file
        // beside it. The folder is rebuilt from nothing, so it is written here rather than committed.
        onSuccess: async () => {
            writeFileSync(`${bin}/package.json`, '{ "type": "module" }\n');
        },
    },
    // The settings panel's script, which the app runs in its own browser beside `ui/station.html`. A
    // plain script rather than a module, named as the page names it, and never cleaned: the page and
    // the rest of `ui/` are committed, and only this file is built.
    {
        entry: { station: 'src/inspector/station.inspector.ts' },
        format: ['iife'],
        platform: 'browser',
        target: 'es2022',
        outDir: 'radio.deadair.streamdeck.sdPlugin/ui',
        outExtension: () => ({ js: '.js' }),
        sourcemap: false,
        clean: false,
    },
]);
