/**
 * End-to-end proof that the station can speak, without a server or a database.
 *
 * Wires the real Kokoro plugin to the real `PluginHostFactory` and drains it exactly as
 * `SpeechService` does: `speak` opens a stream, `readStream` pulls it a chunk at a time, and the
 * chunks land in a real `SegmentStore`. Everything between the manifest's allowlist and the bytes on
 * disk is the shipping code path.
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
import type { PluginConfigService } from '../src/modules/plugins/plugin.config.service.js';
import type { PluginStorageRepository } from '../src/modules/plugins/plugin.storage.repository.js';
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

const config = { baseUrl: BASE_URL, model: 'kokoro', format: 'mp3', defaultVoice: 'af_heart', voices: 'host = af_bella' };

const factory = new PluginHostFactory(
    new PluginHostFactoryOptions('http://localhost:3333'),
    { getConfig: async () => config, getSecrets: async () => ({}) } as unknown as PluginConfigService,
    {} as unknown as PluginStorageRepository,
    { for: () => consoleLogger } as never,
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

let chunks = 0;
async function* drain(): AsyncGenerator<Uint8Array> {
    for (;;) {
        const chunk = await plugin.readStream(handle.streamId, 256 * 1024);
        if (chunk.done) return;
        if (chunk.data === undefined) continue;
        chunks += 1;
        yield Buffer.from(chunk.data, 'base64');
    }
}

try {
    const checksum = await store.writeStream(drain(), 'mp3');
    const path = store.pathFor(checksum, 'mp3');
    const { size } = await stat(path);

    console.log(`  drained ${chunks} chunks in ${Date.now() - started}ms total`);
    console.log(`  wrote ${size} bytes to ${path}`);
    console.log(`\n  play it:  afplay ${path}\n`);

    if (size < 1024) throw new Error(`only ${size} bytes: that is not audio`);
} finally {
    await plugin.closeStream(handle.streamId);
    await plugin.dispose?.();
    // The file is the point, so the directory stays. Say where, and let the caller bin it.
    console.log(`  (temp store at ${root} — rm -rf it when done)`);
    await rm(join(root, 'nothing'), { force: true });
}
