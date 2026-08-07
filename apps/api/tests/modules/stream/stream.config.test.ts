// The materializer is the only thing standing between a database setting and what
// Icecast and Liquidsoap actually run, and every mistake it can make is silent:
// the containers read their config once at startup, from files nobody looks at.
//
// So the cases here are the ones where a wrong render would come back as a symptom
// far from its cause — a password broken by quoting, a mount name mangled by XML
// escaping, a skipped render leaving the station on last week's config.

import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { writeStreamConfig, type StreamPlayoutConfig } from '../../../src/modules/stream/stream.config.js';
import type { StreamSettings } from '../../../src/modules/stream/stream.settings.js';

const TEMPLATE = `<icecast>
  <admin>{{ADMIN_EMAIL}}</admin>
  <source-password>{{SOURCE_PASSWORD}}</source-password>
  <admin-password>{{ADMIN_PASSWORD}}</admin-password>
  <hostname>{{HOSTNAME}}</hostname>
  <mount-name>{{MOUNT}}</mount-name>
  <stream-name>{{STREAM_NAME}}</stream-name>
  <stream-description>{{STREAM_DESCRIPTION}}</stream-description>
  <unknown>{{NOT_A_TOKEN}}</unknown>
</icecast>
`;

const settings = (overrides: Partial<StreamSettings> = {}): StreamSettings => ({
    title: 'Deadair',
    description: '',
    genre: 'Music',
    publicUrl: '',
    mount: '/live.mp3',
    bitrate: '128',
    hostname: '',
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
    playoutAiredUrl: 'http://host.docker.internal:3333/api/playout/aired',
    playoutBridgeSecret: 'bridge-secret',
    talkOverTracks: true,
    duckGainDb: -12,
    duckFadeMs: 300,
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

describe('writeStreamConfig', () => {
    it('renders both files and reports success', () => {
        const { assetsDir, configDir } = dirs();

        expect(writeStreamConfig({ settings: settings(), playout: playout(), assetsDir, configDir })).toBe(true);

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
        expect(env.get('PLAYOUT_AIRED_URL')).toBe('http://host.docker.internal:3333/api/playout/aired');
        expect(env.get('SPOTIFY_SHIM_SECRET')).toBe('shim-secret');
        expect(env.get('HARBOR_PASSWORD')).toBe('harbor-pw');
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

    it('falls back to localhost when there is neither a public URL nor a hostname', () => {
        const { assetsDir, configDir } = dirs();
        writeStreamConfig({ settings: settings(), playout: playout(), assetsDir, configDir });

        expect(readFileSync(join(configDir, 'icecast.xml'), 'utf8')).toContain('<hostname>localhost</hostname>');
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

        expect(wrote).toBe(false);
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

        expect(wrote).toBe(false);
        expect(log.join(' ')).toContain('icecast template missing');
    });
});
