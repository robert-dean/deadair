/**
 * End-to-end proof that the station can speak through a Rhapsode server.
 *
 * The third sibling of `verify.speech.ts` and `verify.chatterbox.ts`, and its own script for the
 * same reason those two are separate: the interesting half is different. There is no model lifecycle
 * to watch here, because the server owns residency — what is worth watching instead is what the
 * server SAYS it can do and whether what this plugin then tells the station matches it. That is the
 * whole argument for the plugin, and it is the part no unit test can settle, since a test's
 * capability document is one this repository wrote.
 *
 * Everything between the manifest's allowlist and the bytes on disk is the shipping code path, read
 * exactly as `SpeechService` reads it.
 *
 *   pnpm --filter @deadair/api exec node --import @swc-node/register/esm-register scripts/verify.rhapsode.ts [baseUrl] [engine] [words...]
 *
 * It reports, in order: what the server says about itself, which engines it has, what the chosen
 * engine can do, what this plugin makes of that, how long the first byte took (which is the cold
 * start if a model had to be loaded), and what is resident afterwards. The `tone` engine is a sine
 * wave and needs no weights, which makes it the cheapest thing to prove the whole path with:
 *
 *   ... scripts/verify.rhapsode.ts http://localhost:8080 tone
 */

import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginManifest, SpeechPluginInstance } from '@deadair/plugin-sdk';

import { RhapsodePlugin, rhapsodeManifest } from '../../../plugins/rhapsode/src/rhapsode.plugin.js';
import { PluginHostFactory, PluginHostFactoryOptions } from '../src/modules/plugins/plugin.host.factory.js';
import type { Container } from 'injectkit';
import type { PluginConfigService } from '../src/modules/plugins/plugin.config.service.js';
import { PluginStorageRepository } from '../src/modules/plugins/plugin.storage.repository.js';
import { SegmentStore } from '../src/modules/render/segment.store.js';

/** Overridable as the first argument rather than through the environment: see `verify.speech.ts`. */
const BASE_URL = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://localhost:8080';
const rest = process.argv.slice(BASE_URL === process.argv[2] ? 3 : 2);
const ENGINE = rest[0] !== undefined && !rest[0].includes(' ') ? rest[0] : 'kokoro';
const SCRIPT = rest.slice(ENGINE === rest[0] ? 1 : 0).join(' ') || "You're listening to Deadair. That was Boards of Canada.";

const consoleLogger = {
    debug: (message: string, meta?: unknown) => console.log(`  [debug] ${message}`, meta ?? ''),
    info: (message: string, meta?: unknown) => console.log(`  [info]  ${message}`, meta ?? ''),
    warn: (message: string, meta?: unknown) => console.log(`  [warn]  ${message}`, meta ?? ''),
    error: (message: string, meta?: unknown) => console.log(`  [error] ${message}`, meta ?? ''),
};

/** Asked directly rather than through the plugin, so the report is about the SERVER and not about us. */
const ask = async <T>(path: string): Promise<T | undefined> => {
    try {
        const response = await fetch(`${BASE_URL}${path}`);
        return response.ok ? ((await response.json()) as T) : undefined;
    } catch {
        return undefined;
    }
};

interface Health {
    contract: number;
    status: string;
    engines: { id: string; process: string; model: string }[];
    residency: { resident: number; max: number };
}

interface Capabilities {
    current?: { variant: string };
    variants: Record<string, { cues: string[]; deliveries: string[]; dials: Record<string, unknown>; maxCharacters?: number }>;
    formats: string[];
}

const health = await ask<Health>('/health');
if (health === undefined) {
    console.error(`\nnothing at ${BASE_URL} answered as a Rhapsode server\n`);
    process.exit(1);
}

console.log(`\nspeaking through ${BASE_URL} on "${ENGINE}"`);
console.log(`script: "${SCRIPT}"\n`);
console.log(`  server:   contract ${health.contract}, ${health.status}, ${health.engines.length} engines installed`);
console.log(`  engines:  ${health.engines.map(engine => `${engine.id} (${engine.process}/${engine.model})`).join(', ') || 'none'}`);

const document = await ask<Capabilities>(`/engines/${encodeURIComponent(ENGINE)}/capabilities`);
if (document === undefined) {
    console.error(`\n  this server would not say what "${ENGINE}" can do — is it installed?\n`);
    process.exit(1);
}

const effective = document.current?.variant ?? Object.keys(document.variants)[0]!;
const build = document.variants[effective]!;
console.log(`  build:    ${effective}${document.current === undefined ? ' (nothing loaded; this is what it would load)' : ' (loaded)'}`);
console.log(`  it says:  cues [${build.cues.join(', ')}], deliveries [${build.deliveries.join(', ')}], dials [${Object.keys(build.dials).join(', ')}]`);
console.log(`            up to ${build.maxCharacters ?? 'an unstated number of'} characters, encodes [${document.formats.join(', ')}]`);

/**
 * A voice this engine actually holds, read off the server rather than named here.
 *
 * Which voices an engine has is per-install — they include whatever the operator cloned in — so any
 * id written into this file would be one that exists on exactly one machine. The first is as good as
 * any: what is being proved is the address reaching the engine, not which voice it names.
 */
const held = (await ask<{ id: string }[]>(`/engines/${encodeURIComponent(ENGINE)}/voices`)) ?? [];
const VOICE = held[0]?.id;
console.log(`  voices:   ${held.length} (using ${VOICE ?? "the engine's own default"})`);

/**
 * One mapped voice, with a speed on it because that is the path worth exercising.
 *
 * A speed reaches the engine only where the build declares a `speed` dial, and an unknown dial key
 * is a refusal naming it rather than a field quietly ignored — so a row with one is the difference
 * between the two outcomes this script can tell apart, and the debug line above says which happened.
 */
const config = {
    baseUrl: BASE_URL,
    defaultEngine: ENGINE,
    format: 'mp3',
    // 0 rather than blank: the model is freed as soon as this request lets go of it, so a run leaves
    // the card as it found it. The server loads one again on the next synthesis.
    keepAliveSeconds: 0,
    ...(VOICE === undefined ? {} : { voices: JSON.stringify([{ name: 'host', engine: ENGINE, voice: VOICE, speed: '1.1' }]) }),
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

const root = await mkdtemp(join(tmpdir(), 'deadair-verify-rhapsode-'));
const store = new SegmentStore(root);

const manifest: PluginManifest = rhapsodeManifest;
const plugin: SpeechPluginInstance = new RhapsodePlugin();

await plugin.init(factory.createHost(manifest));

// The two halves of the point: what the server said above, and what the station is told below. A
// disagreement here is the bug this plugin exists to prevent, and it is visible in one screen.
console.log(`\n  the station is told:`);
console.log(`            cues [${((await plugin.listCues?.()) ?? []).join(', ')}]`);
console.log(`            deliveries [${((await plugin.listDeliveries?.()) ?? []).join(', ')}]`);
console.log(`            at most ${(await plugin.listLimits?.())?.maxCharacters ?? 'nothing stated'} characters`);

const started = Date.now();
const handle = await plugin.speak({ text: SCRIPT, voice: 'host' });
console.log(`\n  speak() answered in ${Date.now() - started}ms with mime ${handle.mime}`);

let chunks = 0;
const counted = handle.audio.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            chunks += 1;
            controller.enqueue(chunk);
        },
    }),
);

/** What the segment store files this as, going by what the plugin said the bytes are. */
const EXTENSIONS: Record<string, 'mp3' | 'wav' | 'ogg' | 'flac'> = {
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/flac': 'flac',
};

try {
    const extension = EXTENSIONS[handle.mime];
    if (extension === undefined) throw new Error(`the station has nowhere to put "${handle.mime}"`);

    const checksum = await store.writeStream(counted, extension);
    const path = store.pathFor(checksum, extension);
    const { size } = await stat(path);

    console.log(`  read ${chunks} chunks in ${Date.now() - started}ms total`);
    console.log(`  wrote ${size} bytes to ${path}`);

    // `keepAliveSeconds: 0` frees the model on release, and the release happens when the stream ends
    // rather than when `speak` returns, so give the server a moment to act on it.
    await new Promise<void>(resolve => setTimeout(resolve, 2_000));
    const after = await ask<Health>('/health');
    console.log(`  resident after: ${after?.residency.resident ?? '?'} of ${after?.residency.max ?? '?'} slots  (this run asked for keepAliveSeconds 0)`);

    console.log(`\n  play it:  afplay ${path}\n`);
    console.log(`  (temp store at ${root} — rm -rf it when done)\n`);
} catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
}
