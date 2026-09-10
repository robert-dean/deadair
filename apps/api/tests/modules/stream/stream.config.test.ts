// The materializer is the only thing standing between a database setting and what
// Icecast and Liquidsoap actually run, and every mistake it can make is silent:
// the containers read their config once at startup, from files nobody looks at.
//
// So the cases here are the ones where a wrong render would come back as a symptom
// far from its cause — a password broken by quoting, a mount name mangled by XML
// escaping, a skipped render leaving the station on last week's config.

import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseFileMode, writeStreamConfig, type StreamPlayoutConfig } from '../../../src/modules/stream/stream.config.js';
import type { StreamSettings } from '../../../src/modules/stream/stream.settings.js';

/**
 * The repo's own `stream/` directory, found from this file rather than from the process.
 *
 * `defaultStreamAssetsDir` resolves against `process.cwd()`, which is right for the server — it is
 * started from `apps/api` and the relative hop is part of how the workspace is laid out — and wrong
 * for a test, which has no say in where a runner was invoked from. Calling the production helper
 * here made this the one case in the suite that passed or failed on the caller's directory, and it
 * failed as `ENOENT` on a temp path that named neither the template nor the reason.
 *
 * The template is still the SHIPPED one, which is the whole point of the case below: what broke was
 * the artifact Icecast actually reads, and a fixture that agrees with itself would go on passing.
 */
const shippedAssetsDir = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', 'stream');

const TEMPLATE = `<icecast>
  <admin>{{ADMIN_EMAIL}}</admin>
  <source-password>{{SOURCE_PASSWORD}}</source-password>
  <admin-password>{{ADMIN_PASSWORD}}</admin-password>
  <hostname>{{HOSTNAME}}</hostname>
{{LOCATION}}
  <mount-name>{{MOUNT}}</mount-name>
  <stream-name>{{STREAM_NAME}}</stream-name>
  <stream-description>{{STREAM_DESCRIPTION}}</stream-description>
{{LISTENER_HOOKS}}  <unknown>{{NOT_A_TOKEN}}</unknown>
</icecast>
`;

const settings = (overrides: Partial<StreamSettings> = {}): StreamSettings => ({
    title: 'Deadair',
    description: '',
    genre: 'Music',
    publicUrl: '',
    mount: '/live.mp3',
    bitrate: '128',
    // The unconfigured station: MP3 alone, which is what every case here assumes unless
    // it says otherwise.
    opusEnabled: false,
    opusBitrate: '160',
    aacEnabled: false,
    aacBitrate: '192',
    flacEnabled: false,
    hlsEnabled: false,
    hlsSegmentSeconds: 2,
    hlsSegmentCount: 6,
    hostname: '',
    location: '',
    language: '',
    icecastHost: 'icecast',
    icecastPort: '8000',
    sourcePassword: 'source-pw',
    adminPassword: 'admin-pw',
    harborPassword: 'harbor-pw',
    spotifyShimSecret: 'shim-secret',
    playoutBridgeSecret: 'bridge-secret',
    ...overrides,
});

const playout = (overrides: Partial<StreamPlayoutConfig> = {}): StreamPlayoutConfig => ({
    playoutAiredUrl: 'http://host.docker.internal:3333/api/playout/bridge/aired',
    playoutStarveUrl: 'http://host.docker.internal:3333/api/playout/bridge/starve',
    playoutBridgeSecret: 'bridge-secret',
    talkOverTracks: true,
    duckGainDb: -12,
    duckFadeMs: 300,
    voiceGainDb: 0,
    controlTtlS: 6,
    playoutPrefetch: 3,
    ...overrides,
});

/** An assets dir holding the template, plus an empty config dir to render into. */
function dirs(): { assetsDir: string; configDir: string } {
    const root = mkdtempSync(join(tmpdir(), 'deadair-stream-'));
    const assetsDir = join(root, 'assets');
    const configDir = join(root, 'config');
    mkdirSync(assetsDir);
    writeFileSync(join(assetsDir, 'icecast.xml.tmpl'), TEMPLATE);
    return { assetsDir, configDir };
}

/** Parse a rendered radio.env into a map, undoing the single-quoting. */
function parseEnv(contents: string): Map<string, string> {
    const values = new Map<string, string>();
    for (const line of contents.split('\n')) {
        const match = /^(\w+)='(.*)'$/.exec(line);
        if (match) values.set(match[1]!, match[2]!.replace(/'\\''/g, "'"));
    }
    return values;
}

describe('parseFileMode', () => {
    it('reads an octal mode, with or without its leading zero', () => {
        expect(parseFileMode('0640')).toBe(0o640);
        expect(parseFileMode('640')).toBe(0o640);
        expect(parseFileMode(' 0600 ')).toBe(0o600);
    });

    it('is undefined for anything that is not one', () => {
        // `0640` read as decimal is a mode nobody meant, and an empty or misspelt value has to be
        // distinguishable from a real one so the caller can say the setting did not take.
        expect(parseFileMode('')).toBeUndefined();
        expect(parseFileMode('rw-r-----')).toBeUndefined();
        expect(parseFileMode('0899')).toBeUndefined();
        expect(parseFileMode('06400')).toBeUndefined();
    });
});

describe('writeStreamConfig, on the mode of what it renders', () => {
    const modeOf = (path: string) => statSync(path).mode & 0o777;

    it('leaves the files readable by everything on the volume by default', () => {
        // The default has to serve the deployment where the parts are separate containers under
        // uids this project does not choose.
        const { assetsDir, configDir } = dirs();

        writeStreamConfig({ settings: settings(), playout: playout(), assetsDir, configDir });

        expect(modeOf(join(configDir, 'icecast.xml'))).toBe(0o644);
        expect(modeOf(join(configDir, 'radio.env'))).toBe(0o644);
    });

    it('writes them narrow when the deployment asks for it', () => {
        const { assetsDir, configDir } = dirs();

        writeStreamConfig({ settings: settings(), playout: playout(), assetsDir, configDir, configMode: 0o640 });

        expect(modeOf(join(configDir, 'icecast.xml'))).toBe(0o640);
        expect(modeOf(join(configDir, 'radio.env'))).toBe(0o640);
    });

    // The case that would otherwise leave a station holding the old permissions for good: moving
    // to a deployment that can be narrower changes no setting, so the content is identical and the
    // write is skipped — which is exactly what makes the skip safe for everything else.
    it('narrows a file it has already written, without rewriting it', () => {
        const { assetsDir, configDir } = dirs();
        const args = { settings: settings(), playout: playout(), assetsDir, configDir };

        writeStreamConfig(args);
        const first = statSync(join(configDir, 'icecast.xml')).mtimeMs;

        writeStreamConfig({ ...args, configMode: 0o640 });

        expect(modeOf(join(configDir, 'icecast.xml'))).toBe(0o640);
        // The mtime is what the staleness check compares a container's start time against, so a
        // permission change must not read as a config the containers have yet to adopt.
        expect(statSync(join(configDir, 'icecast.xml')).mtimeMs).toBe(first);
    });
});

describe('writeStreamConfig', () => {
    it('renders both files and reports success', () => {
        const { assetsDir, configDir } = dirs();

        expect(writeStreamConfig({ settings: settings(), playout: playout(), assetsDir, configDir })).toBeDefined();

        expect(readFileSync(join(configDir, 'icecast.xml'), 'utf8')).toContain('<source-password>source-pw</source-password>');
        expect(parseEnv(readFileSync(join(configDir, 'radio.env'), 'utf8')).get('ICECAST_SOURCE_PASSWORD')).toBe('source-pw');
    });

    it('carries the playout bridge secret and aired URL into radio.env', () => {
        // These two are the whole app-to-Liquidsoap contract: without them the control
        // endpoints reject every push and no item is ever confirmed on air.
        const { assetsDir, configDir } = dirs();
        writeStreamConfig({ settings: settings(), playout: playout(), assetsDir, configDir });

        const env = parseEnv(readFileSync(join(configDir, 'radio.env'), 'utf8'));
        expect(env.get('PLAYOUT_BRIDGE_SECRET')).toBe('bridge-secret');
        expect(env.get('PLAYOUT_AIRED_URL')).toBe('http://host.docker.internal:3333/api/playout/bridge/aired');
        expect(env.get('PLAYOUT_STARVE_URL')).toBe('http://host.docker.internal:3333/api/playout/bridge/starve');
        expect(env.get('SPOTIFY_SHIM_SECRET')).toBe('shim-secret');
        expect(env.get('HARBOR_PASSWORD')).toBe('harbor-pw');
    });

    it('writes every mixer knob, including the ones whose value is zero', () => {
        // radio.liq reads these at startup and tolerates a missing key, so a knob left out
        // when it happens to be at its default is one an operator cannot find in the
        // rendered file and cannot tell apart from a materializer that skipped it.
        const { assetsDir, configDir } = dirs();
        writeStreamConfig({ settings: settings(), playout: playout(), assetsDir, configDir });

        const env = parseEnv(readFileSync(join(configDir, 'radio.env'), 'utf8'));
        expect(env.get('TALK_OVER_TRACKS')).toBe('true');
        expect(env.get('DUCK_GAIN_DB')).toBe('-12');
        expect(env.get('DUCK_FADE_MS')).toBe('300');
        expect(env.get('VOICE_GAIN_DB')).toBe('0');
    });

    it('quotes a value containing a single quote so the env file still sources', () => {
        // radio.env is read with `set -a; . radio.env`, so a naive quote would end the
        // string early and the shell would fail on the rest of the line — taking every
        // variable after it with it.
        const { assetsDir, configDir } = dirs();
        writeStreamConfig({ settings: settings({ title: "Rock 'n' Roll Radio" }), playout: playout(), assetsDir, configDir });

        const raw = readFileSync(join(configDir, 'radio.env'), 'utf8');
        expect(raw).toContain(`STREAM_NAME='Rock '\\''n'\\'' Roll Radio'`);
        expect(parseEnv(raw).get('STREAM_NAME')).toBe("Rock 'n' Roll Radio");
    });

    it('escapes XML metacharacters in a rendered token', () => {
        const { assetsDir, configDir } = dirs();
        writeStreamConfig({ settings: settings({ title: 'Rock & Roll <Radio>' }), playout: playout(), assetsDir, configDir });

        expect(readFileSync(join(configDir, 'icecast.xml'), 'utf8')).toContain('<stream-name>Rock &amp; Roll &lt;Radio&gt;</stream-name>');
    });

    it('gives the mount the source credential, which is what authorises a metadata update', () => {
        // Measured on Icecast 2.5.0: a mount-scoped admin command is authorised against the
        // MOUNT's own username and password, and the global <source-password> is not a
        // substitute — it lets a source connect and nothing more. Without these,
        // /admin/metadata answered 401 to the source credential and to the admin one alike, and
        // for an MP3 mount that endpoint IS the metadata path, so every label the station pushed
        // was accepted by Liquidsoap and then silently dropped.
        //
        // Asserted against the same value as <source-password> rather than a literal: they are
        // one credential written twice, and the whole failure was them not matching.
        //
        // Rendered from the SHIPPED template rather than this file's fixture, which is the only
        // version of this test worth having: what broke was the artifact Icecast actually reads,
        // and a fixture that agrees with itself would have gone on passing throughout.
        const { configDir } = dirs();
        const render = writeStreamConfig({ settings: settings(), playout: playout(), assetsDir: shippedAssetsDir(), configDir });

        // Asserted first, because `writeStreamConfig` answers `undefined` for a template it could
        // not read rather than throwing. Without this, a wrong assets directory surfaces as an
        // ENOENT on a temp path two lines down, which names neither the template nor the reason.
        expect(render).toBeDefined();

        const xml = readFileSync(join(configDir, 'icecast.xml'), 'utf8');
        const sourcePassword = /<source-password>(.*?)<\/source-password>/.exec(xml)?.[1];

        expect(sourcePassword).toBeTruthy();
        // `source` is Liquidsoap's own default for output.icecast's `user`, which radio.liq does
        // not override. The two halves of that pair are here and there.
        expect(xml).toContain('<username>source</username>');
        expect(xml).toContain(`<password>${sourcePassword}</password>`);
    });

    it('renders no extra mount blocks for a station that publishes MP3 alone', () => {
        const { configDir } = dirs();
        writeStreamConfig({ settings: settings(), playout: playout(), assetsDir: shippedAssetsDir(), configDir });

        const xml = readFileSync(join(configDir, 'icecast.xml'), 'utf8');

        // One mount, and no leftover token where the others would go.
        expect(xml.match(/<mount type=/g)).toHaveLength(1);
        expect(xml).not.toContain('{{EXTRA_MOUNTS}}');
    });

    it('gives every extra mount its own credentials, so its metadata updates are not refused', () => {
        // The same failure as the MP3 mount's block above, which would come straight back
        // on three mounts at once: a mount that declares no username and password has
        // nothing to authorise a mount-scoped /admin/metadata against, and every ICY title
        // for it is accepted by Liquidsoap and then silently dropped.
        //
        // Against the SHIPPED template, for the reason the case above is.
        const { configDir } = dirs();
        const render = writeStreamConfig({
            settings: settings({ opusEnabled: true, aacEnabled: true, flacEnabled: true }),
            playout: playout(),
            assetsDir: shippedAssetsDir(),
            configDir,
        });
        expect(render).toBeDefined();

        const xml = readFileSync(join(configDir, 'icecast.xml'), 'utf8');
        const sourcePassword = /<source-password>(.*?)<\/source-password>/.exec(xml)?.[1];

        expect(xml.match(/<mount type=/g)).toHaveLength(4);
        for (const path of ['/live.opus', '/live.aac', '/live.flac']) {
            const block = new RegExp(`<mount type="normal">\\s*<mount-name>${path.replace('.', '\\.')}</mount-name>[\\s\\S]*?</mount>`).exec(
                xml,
            )?.[0];
            expect(block).toBeTruthy();
            expect(block).toContain('<username>source</username>');
            expect(block).toContain(`<password>${sourcePassword}</password>`);
        }
    });

    it('leaves the buffers exactly as they were for an unchanged station', () => {
        // The sizes are derived now rather than written as literals, and the derivation has
        // to agree with the committed cold-boot config at the default bitrate — otherwise
        // every station re-renders on upgrade and the staleness check reports a config
        // change nobody made.
        const { configDir } = dirs();
        writeStreamConfig({ settings: settings(), playout: playout(), assetsDir: shippedAssetsDir(), configDir });

        const xml = readFileSync(join(configDir, 'icecast.xml'), 'utf8');
        expect(xml).toContain('<queue-size>524288</queue-size>');
        expect(xml).toContain('<burst-size>8192</burst-size>');
    });

    it('grows the queue for a lossless mount, which is the trap the byte count sets', () => {
        // `queue-size` is BYTES. Left at 524288 a FLAC mount has 4.7s of slow-client
        // tolerance where the MP3 mount had 32, so a station that switched lossless on
        // would start dropping listeners it had been carrying — and the fault reads as
        // "the new high-quality mount keeps cutting people off".
        const { configDir } = dirs();
        writeStreamConfig({ settings: settings({ flacEnabled: true }), playout: playout(), assetsDir: shippedAssetsDir(), configDir });

        const xml = readFileSync(join(configDir, 'icecast.xml'), 'utf8');
        const queue = Number(/<queue-size>(\d+)<\/queue-size>/.exec(xml)?.[1]);

        // ~900 kbps for 20 seconds, and comfortably more than the MP3-only figure.
        expect(queue).toBe(Math.ceil(((900 * 1000) / 8) * 20));
        expect(queue).toBeGreaterThan(524_288);
    });

    it('does not make every listener pay for the lossless mount is burst', () => {
        // The burst is BACKLOG: a listener starts that far behind the live edge and stays
        // there. Sizing the global one for FLAC would hand every MP3 listener seconds of
        // latency to buy a lossless listener half of one, so the global stays the MP3
        // mount's and FLAC carries its own.
        const { configDir } = dirs();
        writeStreamConfig({ settings: settings({ flacEnabled: true }), playout: playout(), assetsDir: shippedAssetsDir(), configDir });

        const xml = readFileSync(join(configDir, 'icecast.xml'), 'utf8');
        const limits = /<limits>[\s\S]*?<\/limits>/.exec(xml)?.[0] ?? '';
        const flac = /<mount type="normal">\s*<mount-name>\/live\.flac<\/mount-name>[\s\S]*?<\/mount>/.exec(xml)?.[0] ?? '';

        expect(limits).toContain('<burst-size>8192</burst-size>');
        expect(Number(/<burst-size>(\d+)<\/burst-size>/.exec(flac)?.[1])).toBe(Math.ceil(((900 * 1000) / 8) * 0.5));
    });

    it('writes every optional mount key, in a fixed order, even with all of them off', () => {
        // Two failures in one. A key that appears only when it is non-default is a key an
        // operator cannot find when they go looking for why their mount is not there. And a
        // key ORDER that moves with the settings changes the config stamp, which is the hash
        // the staleness check compares a running container against.
        const { assetsDir, configDir } = dirs();
        writeStreamConfig({ settings: settings(), playout: playout(), assetsDir, configDir });

        const raw = readFileSync(join(configDir, 'radio.env'), 'utf8');
        const env = parseEnv(raw);

        expect(env.get('STREAM_MOUNT_OPUS')).toBe('');
        expect(env.get('STREAM_MOUNT_AAC')).toBe('');
        expect(env.get('STREAM_MOUNT_FLAC')).toBe('');
        expect(raw.indexOf('STREAM_MOUNT_OPUS')).toBeLessThan(raw.indexOf('STREAM_MOUNT_AAC'));
        expect(raw.indexOf('STREAM_MOUNT_AAC')).toBeLessThan(raw.indexOf('STREAM_MOUNT_FLAC'));
    });

    it('hands liquidsoap the derived paths rather than making it derive them again', () => {
        // Doing the extension swap twice, in two languages, is how the app comes to be
        // counting listeners on a mount Liquidsoap called something else.
        const { assetsDir, configDir } = dirs();
        writeStreamConfig({
            settings: settings({ mount: '/wbcn.mp3', opusEnabled: true, flacEnabled: true }),
            playout: playout(),
            assetsDir,
            configDir,
        });

        const env = parseEnv(readFileSync(join(configDir, 'radio.env'), 'utf8'));

        expect(env.get('STREAM_MOUNT_OPUS')).toBe('/wbcn.opus');
        expect(env.get('STREAM_OPUS_BITRATE')).toBe('160');
        expect(env.get('STREAM_MOUNT_FLAC')).toBe('/wbcn.flac');
        // Lossless: there is no bitrate to set, and an empty value says so.
        expect(env.get('STREAM_FLAC_BITRATE')).toBe('');
        // Off, and an empty path is how that is spelled.
        expect(env.get('STREAM_MOUNT_AAC')).toBe('');
    });

    it('gives liquidsoap nowhere to write HLS until it is switched on', () => {
        // The same rule as an optional mount's empty path: a writer with nowhere to write
        // is not a writer, so there is no second flag that could disagree with it.
        const { assetsDir, configDir } = dirs();
        writeStreamConfig({ settings: settings(), playout: playout(), assetsDir, configDir });

        const env = parseEnv(readFileSync(join(configDir, 'radio.env'), 'utf8'));

        expect(env.get('STREAM_HLS_DIR')).toBe('');
        // The shape of it is still written, so an operator can see what it would be.
        expect(env.get('STREAM_HLS_SEGMENT_SECONDS')).toBe('2');
        expect(env.get('STREAM_HLS_SEGMENT_COUNT')).toBe('6');
    });

    it("writes the STREAM container's own path, not the one this app reads back", () => {
        // They are one volume at two mount points. Rendering the app's path into the
        // container's config gives liquidsoap a directory that does not exist there, and
        // the symptom is an HLS output that silently writes nothing.
        const { assetsDir, configDir } = dirs();
        writeStreamConfig({
            settings: settings({ hlsEnabled: true }),
            playout: playout(),
            assetsDir,
            configDir,
            hlsDir: '/streamhls',
        });

        expect(parseEnv(readFileSync(join(configDir, 'radio.env'), 'utf8')).get('STREAM_HLS_DIR')).toBe('/streamhls');
    });

    // The listener hooks are gone: `/admin/eventfeed` reports every change in the count in either
    // direction, so nothing is gained by holding a listener's own connection open on a call to this
    // app — and a great deal is lost when the app is down.
    it('renders no listener authentication at all', () => {
        const { assetsDir, configDir } = dirs();
        writeStreamConfig({ settings: settings(), playout: playout(), assetsDir, configDir });

        expect(readFileSync(join(configDir, 'icecast.xml'), 'utf8')).not.toContain('<authentication');
    });

    it('leaves an unrecognised template token in place rather than blanking it', () => {
        // A typo'd token that rendered as empty would look like a deliberately blank
        // setting; left as written it is visible in the file that is actually running.
        const { assetsDir, configDir } = dirs();
        writeStreamConfig({ settings: settings(), playout: playout(), assetsDir, configDir });

        expect(readFileSync(join(configDir, 'icecast.xml'), 'utf8')).toContain('<unknown>{{NOT_A_TOKEN}}</unknown>');
    });

    it('derives the advertised hostname from the public URL', () => {
        const { assetsDir, configDir } = dirs();
        writeStreamConfig({ settings: settings({ publicUrl: 'https://radio.example.com/live' }), playout: playout(), assetsDir, configDir });

        expect(readFileSync(join(configDir, 'icecast.xml'), 'utf8')).toContain('<hostname>radio.example.com</hostname>');
    });

    it('advertises the configured hostname over the public URL, as both settings say it does', () => {
        // It was the other way round: with both set, the public URL won and the hostname field was
        // ignored, which neither setting's help text admitted.
        const { assetsDir, configDir } = dirs();
        writeStreamConfig({
            settings: settings({ publicUrl: 'https://radio.example.com/live', hostname: 'icecast.example.net' }),
            playout: playout(),
            assetsDir,
            configDir,
        });

        expect(readFileSync(join(configDir, 'icecast.xml'), 'utf8')).toContain('<hostname>icecast.example.net</hostname>');
    });

    it('falls back to localhost when the public URL does not parse and no hostname is set', () => {
        // A malformed URL is a setting to fix, not a reason to skip the render.
        const { assetsDir, configDir } = dirs();
        writeStreamConfig({ settings: settings({ publicUrl: 'not a url' }), playout: playout(), assetsDir, configDir });

        expect(readFileSync(join(configDir, 'icecast.xml'), 'utf8')).toContain('<hostname>localhost</hostname>');
    });

    it('renders a location only when the operator set one', () => {
        // "Earth" used to be hardcoded here, and it is the placeholder Icecast 2.5's
        // dashboard flags as unset. No location is more honest than a wrong one.
        const unset = dirs();
        writeStreamConfig({ settings: settings(), playout: playout(), ...unset });
        expect(readFileSync(join(unset.configDir, 'icecast.xml'), 'utf8')).not.toContain('<location>');

        const set = dirs();
        writeStreamConfig({ settings: settings({ location: 'Bristol, UK' }), playout: playout(), ...set });
        expect(readFileSync(join(set.configDir, 'icecast.xml'), 'utf8')).toContain('<location>Bristol, UK</location>');
    });

    it('hands the language to liquidsoap rather than to icecast', () => {
        // Icecast learns it from the source's Content-Language header, and there is no
        // server-side option for it at all, so it rides radio.env.
        const { assetsDir, configDir } = dirs();
        writeStreamConfig({ settings: settings({ language: 'en-GB' }), playout: playout(), assetsDir, configDir });

        expect(parseEnv(readFileSync(join(configDir, 'radio.env'), 'utf8')).get('STREAM_LANGUAGE')).toBe('en-GB');
        expect(readFileSync(join(configDir, 'icecast.xml'), 'utf8')).not.toContain('en-GB');
    });

    it('falls back to localhost when there is neither a public URL nor a hostname', () => {
        const { assetsDir, configDir } = dirs();
        writeStreamConfig({ settings: settings(), playout: playout(), assetsDir, configDir });

        expect(readFileSync(join(configDir, 'icecast.xml'), 'utf8')).toContain('<hostname>localhost</hostname>');
    });

    it('leaves the file untouched when a re-render produces identical content', async () => {
        // The mtime is the evidence a container's start time is compared against, so a
        // render that always wrote would make every app restart look like a config change
        // nobody had adopted — and there would be no way left to see a real one.
        const { assetsDir, configDir } = dirs();
        const first = writeStreamConfig({ settings: settings(), playout: playout(), assetsDir, configDir });

        // Long enough for a filesystem with a coarse mtime to record a second write.
        await new Promise(resolve => setTimeout(resolve, 20));
        const second = writeStreamConfig({ settings: settings(), playout: playout(), assetsDir, configDir });

        expect(second?.radio.changedAt).toBe(first?.radio.changedAt);
        expect(second?.icecast.changedAt).toBe(first?.icecast.changedAt);
        expect(second?.radio.stamp).toBe(first?.radio.stamp);
    });

    it('moves the stamp and the mtime when a secret changes', async () => {
        const { assetsDir, configDir } = dirs();
        const before = writeStreamConfig({ settings: settings(), playout: playout(), assetsDir, configDir });

        await new Promise(resolve => setTimeout(resolve, 20));
        const after = writeStreamConfig({
            settings: settings({ sourcePassword: 'reseeded' }),
            playout: playout(),
            assetsDir,
            configDir,
        });

        expect(after?.radio.stamp).not.toBe(before?.radio.stamp);
        expect(after?.radio.changedAt).toBeGreaterThan(before?.radio.changedAt ?? 0);
        expect(after?.icecast.changedAt).toBeGreaterThan(before?.icecast.changedAt ?? 0);
    });

    it('leaves no partial file behind for a container to source', () => {
        // Both files are written beside themselves and renamed over, so a reader only
        // ever sees a whole one. `set -a; . radio.env` on a truncated file is SILENT —
        // it defines the variables that made it and skips the rest — so a half-written
        // radio.env is a Liquidsoap with a source password and no bridge secret, and
        // nothing anywhere saying why.
        const { assetsDir, configDir } = dirs();
        writeStreamConfig({ settings: settings(), playout: playout(), assetsDir, configDir });

        expect(readdirSync(configDir).sort()).toEqual(['icecast.xml', 'radio.env']);
    });

    it('writes the stamp into radio.env as the generation the script reports back', () => {
        // The whole liquidsoap half of the drift reading: radio.liq echoes this on every
        // /control/* answer, so the app compares proof rather than two clocks.
        const { assetsDir, configDir } = dirs();
        const render = writeStreamConfig({ settings: settings(), playout: playout(), assetsDir, configDir });

        const env = parseEnv(readFileSync(join(configDir, 'radio.env'), 'utf8'));
        expect(env.get('CONFIG_STAMP')).toBe(render?.radio.stamp);
        expect(env.get('CONFIG_STAMP')).toMatch(/^[0-9a-f]{12}$/);
    });

    it('skips, without throwing, when the Icecast passwords are unset', () => {
        const { assetsDir, configDir } = dirs();
        const log: string[] = [];

        const wrote = writeStreamConfig({
            settings: settings({ sourcePassword: undefined }),
            playout: playout(),
            assetsDir,
            configDir,
            log: message => log.push(message),
        });

        expect(wrote).toBeUndefined();
        expect(log.join(' ')).toContain('not configured');
    });

    it('skips, without throwing, when the template is missing', () => {
        // The app can run from a checkout with no stream/ assets; that costs the
        // containers their rendered config, not the app its boot.
        const { configDir } = dirs();
        const log: string[] = [];

        const wrote = writeStreamConfig({
            settings: settings(),
            playout: playout(),
            assetsDir: join(tmpdir(), 'deadair-stream-does-not-exist'),
            configDir,
            log: message => log.push(message),
        });

        expect(wrote).toBeUndefined();
        expect(log.join(' ')).toContain('icecast template missing');
    });
});
