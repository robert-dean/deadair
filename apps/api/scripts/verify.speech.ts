/**
 * End-to-end proof that the station can speak, without a server or a database.
 *
 * Wires the real Kokoro plugin to the real `PluginHostFactory` and reads it exactly as
 * `SpeechService` does: `speak` hands back the engine's response body and it goes straight into a
 * real `SegmentStore`. Everything between the manifest's allowlist and the bytes on disk is the
 * shipping code path.
 *
 * What it deliberately skips is the parts a unit test already pins: the job's state transitions and
 * the route. Those need a database and a session; this needs a Kokoro on the other end, which is the
 * thing no test can stand in for.
 *
 *   pnpm --filter @deadair/api exec node --import @swc-node/register/esm-register scripts/verify.speech.ts
 *
 * Takes an optional base URL as the first argument, then the words to say.
 */

import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginManifest, SpeechPluginInstance } from '@deadair/plugin-sdk';

import { KokoroPlugin, kokoroManifest } from '../../../plugins/kokoro/src/kokoro.plugin.js';
import { PluginHostFactory, PluginHostFactoryOptions } from '../src/modules/plugins/plugin.host.factory.js';
import type { Container } from 'injectkit';
import type { PluginConfigService } from '../src/modules/plugins/plugin.config.service.js';
import { PluginStorageRepository } from '../src/modules/plugins/plugin.storage.repository.js';
import { SegmentStore } from '../src/modules/render/segment.store.js';

/**
 * Where Kokoro is. Overridable as the first argument rather than through the environment, because
 * turbo audits env vars a package reads and this script is not part of any task it runs.
 */
const BASE_URL = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://localhost:8880/v1';
const SCRIPT = process.argv.slice(BASE_URL === process.argv[2] ? 3 : 2).join(' ') || "You're listening to Deadair. That was Boards of Canada.";

const consoleLogger = {
    debug: (message: string, meta?: unknown) => console.log(`  [debug] ${message}`, meta ?? ''),
    info: (message: string, meta?: unknown) => console.log(`  [info]  ${message}`, meta ?? ''),
    warn: (message: string, meta?: unknown) => console.log(`  [warn]  ${message}`, meta ?? ''),
    error: (message: string, meta?: unknown) => console.log(`  [error] ${message}`, meta ?? ''),
};

const config = {
    baseUrl: BASE_URL,
    model: 'kokoro',
    format: 'mp3',
    defaultVoice: 'af_heart',
    // A `list` field, so its stored form is a JSON array of row objects exactly as the console would
    // have written it. The speed is here rather than omitted because it is the one part of the row
    // that reaches the engine's request body, and this script is the only thing that proves a real
    // server accepts it.
    voices: JSON.stringify([{ name: 'host', engine: 'af_bella', speed: '0.95' }]),
};

/**
 * A container holding just the two scoped services the host resolves.
 *
 * The factory takes the ROOT container rather than the services themselves, because it is
 * a singleton and both of those are scoped: holding either would freeze one scope's
 * instance and keep using it after the transaction behind it was gone. So it opens a
 * scope per call, and this hands back the same stubs from every one of them.
 *
 * Nothing here touches Postgres. Speech is the one capability that needs no storage, so
 * the repository is a stub that answers empty rather than a real one over a pool this
 * script would otherwise have to build.
 */
const pluginConfig = { getConfig: async () => config, getSecrets: async () => ({}) } as unknown as PluginConfigService;
const pluginStorage = {
    get: async () => undefined,
    set: async () => {},
    delete: async () => {},
    listKeys: async () => [],
} as unknown as PluginStorageRepository;

const container = {
    createScopedContainer: () => ({
        get: (token: unknown) => (token === PluginStorageRepository ? pluginStorage : pluginConfig),
        disposeAsync: async () => {},
    }),
} as unknown as Container;

const factory = new PluginHostFactory(
    new PluginHostFactoryOptions('http://localhost:3333'),
    container,
    { for: () => consoleLogger } as never,
    {
        // Never reached: the shim client is how a spotify host fetches audio, and this script
        // only ever builds a speech host.
    } as never,
    // The operator's escape hatch, off. The speech engine's address is an allowlist entry the
    // manifest resolves from config, so nothing here ever asks about a host it did not declare.
    { isUnrestricted: () => false } as never,
);

const root = await mkdtemp(join(tmpdir(), 'deadair-verify-speech-'));
const store = new SegmentStore(root);

const manifest: PluginManifest = kokoroManifest;
const plugin: SpeechPluginInstance = new KokoroPlugin();

console.log(`\nspeaking through ${BASE_URL}`);
console.log(`script: "${SCRIPT}"\n`);

await plugin.init(factory.createHost(manifest));

const started = Date.now();
const handle = await plugin.speak({ text: SCRIPT, voice: 'host' });
console.log(`  speak() answered in ${Date.now() - started}ms with mime ${handle.mime}`);

// Counted for the report, and it is worth reporting: one chunk would mean the body was buffered
// somewhere it should not have been.
let chunks = 0;
const counted = handle.audio.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            chunks += 1;
            controller.enqueue(chunk);
        },
    }),
);

try {
    const checksum = await store.writeStream(counted, 'mp3');
    const path = store.pathFor(checksum, 'mp3');
    const { size } = await stat(path);

    console.log(`  read ${chunks} chunks in ${Date.now() - started}ms total`);
    console.log(`  wrote ${size} bytes to ${path}`);
    console.log(`\n  play it:  afplay ${path}\n`);

    if (size < 1024) throw new Error(`only ${size} bytes: that is not audio`);
} finally {
    // `counted`, not `handle.audio`: piping locks the original, so cancelling that one throws.
    await counted.cancel().catch(() => {});
    await plugin.dispose?.();
    // The file is the point, so the directory stays. Say where, and let the caller bin it.
    console.log(`  (temp store at ${root} — rm -rf it when done)`);
    await rm(join(root, 'nothing'), { force: true });
}
