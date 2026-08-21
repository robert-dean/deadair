/**
 * End-to-end proof that the station can speak through Chatterbox, and that it puts the GPU back.
 *
 * The sibling of `verify.speech.ts`, and its own script rather than a flag on that one. The two
 * engines' configs are not the same shape — this one has a model to manage and a switch for whether
 * to manage it — and the interesting half here is the LIFECYCLE, which the other engine has no
 * equivalent of at all. Parameterising one script over both would have made each half harder to
 * read in exchange for saving a wiring block.
 *
 * Everything between the manifest's allowlist and the bytes on disk is the shipping code path, read
 * exactly as `SpeechService` reads it. What it deliberately skips is the parts a unit test already
 * pins: the job's state transitions and the route.
 *
 *   pnpm --filter @deadair/api exec node --import @swc-node/register/esm-register scripts/verify.chatterbox.ts [baseUrl] [words...]
 *
 * It reports, in order: whether a model was resident to begin with, how long the first byte took
 * (which is the cold-start cost if one had to be loaded), whether the audio is plausible, and
 * whether the card was actually freed afterwards. That last line is the one worth watching — the
 * unload is best-effort by design, so a station can believe it is freeing memory and not be.
 */

import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginManifest, SpeechPluginInstance } from '@deadair/plugin-sdk';

import { ChatterboxPlugin, chatterboxManifest } from '../../../plugins/chatterbox/src/chatterbox.plugin.js';
import { serverRoot } from '../../../plugins/chatterbox/src/chatterbox.lifecycle.js';
import { PluginHostFactory, PluginHostFactoryOptions } from '../src/modules/plugins/plugin.host.factory.js';
import type { Container } from 'injectkit';
import type { PluginConfigService } from '../src/modules/plugins/plugin.config.service.js';
import { PluginStorageRepository } from '../src/modules/plugins/plugin.storage.repository.js';
import { SegmentStore } from '../src/modules/render/segment.store.js';

/** Overridable as the first argument rather than through the environment: see `verify.speech.ts`. */
const BASE_URL = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://localhost:8004/v1';
const SCRIPT = process.argv.slice(BASE_URL === process.argv[2] ? 3 : 2).join(' ') || "You're listening to Deadair. That was Boards of Canada.";

const consoleLogger = {
    debug: (message: string, meta?: unknown) => console.log(`  [debug] ${message}`, meta ?? ''),
    info: (message: string, meta?: unknown) => console.log(`  [info]  ${message}`, meta ?? ''),
    warn: (message: string, meta?: unknown) => console.log(`  [warn]  ${message}`, meta ?? ''),
    error: (message: string, meta?: unknown) => console.log(`  [error] ${message}`, meta ?? ''),
};

/**
 * The switch ON, which is the opposite of what ships.
 *
 * Deliberate: the default is off because the trade only pays on a contended card, and a script that
 * ran with the default would exercise the path every station already gets and never the one nobody
 * can check by reading. A run here therefore leaves the server holding nothing, which is a state it
 * recovers from on its own — the next synthesis loads a model back.
 */
const config = {
    baseUrl: BASE_URL,
    model: 'chatterbox',
    format: 'mp3',
    defaultVoice: 'Olivia.wav',
    unloadAfterRender: true,
    voices: JSON.stringify([{ name: 'host', engine: 'Olivia.wav', speed: '0.95' }]),
};

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
    {} as never,
    { isUnrestricted: () => false } as never,
);

/** Asked directly rather than through the plugin, so the report is about the SERVER and not about us. */
const modelResident = async (): Promise<boolean | undefined> => {
    try {
        const response = await fetch(`${serverRoot(BASE_URL)}/api/model-info`);
        if (!response.ok) return undefined;
        return ((await response.json()) as { loaded?: boolean }).loaded === true;
    } catch {
        return undefined;
    }
};

const say = (loaded: boolean | undefined): string => (loaded === undefined ? 'could not tell' : loaded ? 'yes' : 'no');

const root = await mkdtemp(join(tmpdir(), 'deadair-verify-chatterbox-'));
const store = new SegmentStore(root);

const manifest: PluginManifest = chatterboxManifest;
const plugin: SpeechPluginInstance = new ChatterboxPlugin();

console.log(`\nspeaking through ${BASE_URL}`);
console.log(`script: "${SCRIPT}"\n`);
console.log(`  model resident before: ${say(await modelResident())}`);

await plugin.init(factory.createHost(manifest));

const started = Date.now();
const handle = await plugin.speak({ text: SCRIPT, voice: 'host' });
console.log(`  speak() answered in ${Date.now() - started}ms with mime ${handle.mime}`);

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

    // The unload is fired from the stream's own end and is deliberately not awaited by anything, so
    // give it a moment before asking. A poll rather than a sleep would be pretending this is
    // synchronous when the whole point is that it is not.
    await new Promise<void>(resolve => setTimeout(resolve, 2_000));
    console.log(`  model resident after:  ${say(await modelResident())}  (expected: no)`);

    console.log(`\n  play it:  afplay ${path}\n`);
    console.log(`  (temp store at ${root} — rm -rf it when done)\n`);
} catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
}
