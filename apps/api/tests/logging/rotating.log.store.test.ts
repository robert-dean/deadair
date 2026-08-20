import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_LINE_BYTES_CEILING, RotatingLogStore, safeChannel, type RotatingLogStoreOptions } from '../../src/logging/rotating.log.store.js';

const tempDirs: string[] = [];
const openStores: RotatingLogStore[] = [];

async function makeStore(options: Partial<RotatingLogStoreOptions> = {}): Promise<{ store: RotatingLogStore; root: string }> {
    const root = await mkdtemp(join(tmpdir(), 'deadair-log-store-test-'));
    tempDirs.push(root);
    const store = new RotatingLogStore({ root, ...options });
    openStores.push(store);
    return { store, root };
}

afterEach(async () => {
    await Promise.all(openStores.splice(0).map(store => store.close()));
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
    vi.restoreAllMocks();
});

describe('RotatingLogStore constructor', () => {
    it('clamps maxLineBytes to the ceiling and warns when the option exceeds it', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const { store, root } = await makeStore({ maxLineBytes: MAX_LINE_BYTES_CEILING + 1000 });
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('exceeds the'));

        // A message long enough to blow past the ceiling should be truncated to
        // it, not to the (larger) requested value.
        const hugeMessage = 'x'.repeat(MAX_LINE_BYTES_CEILING + 5000);
        store.append(undefined, 'info', hugeMessage);
        await store.close();

        const raw = await readFile(join(root, 'api.log'), 'utf8');
        const line = raw.split('\n').filter(l => l.length > 0)[0] ?? '';
        expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(MAX_LINE_BYTES_CEILING);
    });

    it('does not warn when maxLineBytes is within the ceiling', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await makeStore({ maxLineBytes: 1024 });
        expect(warnSpy).not.toHaveBeenCalled();
    });
});

describe('RotatingLogStore.append / tail', () => {
    it('writes the API log directly under root for an undefined channel and reads it back', async () => {
        const { store, root } = await makeStore();
        store.append(undefined, 'info', 'server started');
        await store.close();

        const raw = await readFile(join(root, 'api.log'), 'utf8');
        expect(raw).toContain('server started');

        // Reopen a fresh store against the same root to read via tail().
        const reader = new RotatingLogStore({ root });
        openStores.push(reader);
        const entries = await reader.tail(undefined);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ level: 'INFO', text: 'server started' });
        expect(entries[0]?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('writes a plugin channel into its own sanitized subdirectory, isolated from other channels', async () => {
        const { store, root } = await makeStore();
        store.append(undefined, 'info', 'api message');
        store.append('my-plugin', 'info', 'plugin message');
        store.append('other-plugin', 'warn', 'other message');
        await store.close();

        const rootFiles = await readdir(root);
        expect(rootFiles).toContain('api.log');
        expect(rootFiles).toContain(safeChannel('my-plugin'));
        expect(rootFiles).toContain(safeChannel('other-plugin'));

        const pluginFile = await readFile(join(root, safeChannel('my-plugin'), 'plugin.log'), 'utf8');
        expect(pluginFile).toContain('plugin message');
        expect(pluginFile).not.toContain('other message');
        expect(pluginFile).not.toContain('api message');
    });

    it('returns entries oldest-first (newest-last) regardless of write order within a segment', async () => {
        const { store, root } = await makeStore();
        store.append(undefined, 'info', 'first');
        store.append(undefined, 'info', 'second');
        store.append(undefined, 'info', 'third');
        await store.close();

        const reader = new RotatingLogStore({ root });
        openStores.push(reader);
        const entries = await reader.tail(undefined);
        expect(entries.map(e => e.text)).toEqual(['first', 'second', 'third']);
    });

    it('caps the returned entries at the requested limit, keeping the newest', async () => {
        const { store, root } = await makeStore();
        for (let i = 0; i < 5; i++) {
            store.append(undefined, 'info', `line-${i}`);
        }
        await store.close();

        const reader = new RotatingLogStore({ root });
        openStores.push(reader);
        const entries = await reader.tail(undefined, { limit: 2 });
        expect(entries.map(e => e.text)).toEqual(['line-3', 'line-4']);
    });

    it('filters by minimum severity level', async () => {
        const { store, root } = await makeStore();
        store.append(undefined, 'trace', 'a trace line');
        store.append(undefined, 'debug', 'a debug line');
        store.append(undefined, 'info', 'an info line');
        store.append(undefined, 'warn', 'a warn line');
        store.append(undefined, 'error', 'an error line');
        await store.close();

        const reader = new RotatingLogStore({ root });
        openStores.push(reader);
        const entries = await reader.tail(undefined, { level: 'warn' });
        expect(entries.map(e => e.text)).toEqual(['a warn line', 'an error line']);
    });

    it('treats level filtering as case-insensitive', async () => {
        const { store, root } = await makeStore();
        store.append(undefined, 'error', 'boom');
        await store.close();

        const reader = new RotatingLogStore({ root });
        openStores.push(reader);
        const entries = await reader.tail(undefined, { level: 'WARN' });
        expect(entries).toHaveLength(1);
    });

    it('returns an empty list for a channel that has never logged', async () => {
        const { store } = await makeStore();
        const entries = await store.tail('never-logged-channel');
        expect(entries).toEqual([]);
    });

    it('redacts values whose meta key matches a sensitive pattern', async () => {
        const { store, root } = await makeStore();
        store.append(undefined, 'info', 'login', { token: 'abc123', apiKey: 'secret-value', userId: 42 });
        await store.close();

        const raw = await readFile(join(root, 'api.log'), 'utf8');
        expect(raw).toContain('token=***');
        expect(raw).toContain('apiKey=***');
        expect(raw).toContain('userId=42');
        expect(raw).not.toContain('abc123');
        expect(raw).not.toContain('secret-value');
    });

    it('writes a token COUNT, which is a measurement rather than a credential', async () => {
        // The pattern matches on a substring, so `tokens` was redacted alongside `access_token` and
        // every model path in the station logged `tokens=***`. It was the only redacted field in
        // the whole live log, and it destroyed the one figure that says what a model call did: a
        // refill accused of exhausting a 12,000-token ceiling could only be shown to have used
        // about 290 by measuring the host's rate elsewhere and dividing.
        const { store, root } = await makeStore();
        store.append(undefined, 'info', 'wrote a break', { tokens: 2897, outputTokens: 332, totalTokens: 2897, maxOutputTokens: 12000 });
        await store.close();

        const raw = await readFile(join(root, 'api.log'), 'utf8');
        expect(raw).toContain('tokens=2897');
        expect(raw).toContain('outputTokens=332');
        expect(raw).toContain('maxOutputTokens=12000');
        expect(raw).not.toContain('***');
    });

    it('still redacts a credential whose key merely starts the same way', async () => {
        // The allowlist is exact keys, so widening it for counts cannot widen it for anything else.
        const { store, root } = await makeStore();
        store.append(undefined, 'info', 'auth', { accessToken: 'abc123', refresh_token: 'def456', token: 'ghi789' });
        await store.close();

        const raw = await readFile(join(root, 'api.log'), 'utf8');
        expect(raw).toContain('accessToken=***');
        expect(raw).toContain('refresh_token=***');
        expect(raw).toContain('token=***');
        expect(raw).not.toMatch(/abc123|def456|ghi789/);
    });

    it('redacts a bearer token embedded inside an otherwise-normal meta value', async () => {
        const { store, root } = await makeStore();
        store.append(undefined, 'info', 'request', { header: 'Bearer abcdef123456' });
        await store.close();

        const raw = await readFile(join(root, 'api.log'), 'utf8');
        expect(raw).toContain('Bearer ***');
        expect(raw).not.toContain('abcdef123456');
    });

    it('truncates a meta value longer than maxValueChars and marks the truncation', async () => {
        const { store, root } = await makeStore({ maxValueChars: 10 });
        store.append(undefined, 'info', 'msg', { note: 'x'.repeat(50) });
        await store.close();

        const raw = await readFile(join(root, 'api.log'), 'utf8');
        expect(raw).toContain(`note=${'x'.repeat(10)}…`);
    });

    it('truncates a whole line longer than maxLineBytes and marks the truncation', async () => {
        const { store, root } = await makeStore({ maxLineBytes: 100 });
        store.append(undefined, 'info', 'y'.repeat(500));
        await store.close();

        const raw = await readFile(join(root, 'api.log'), 'utf8');
        const line = raw.split('\n').filter(l => l.length > 0)[0] ?? '';
        expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(100);
        expect(line.endsWith('…')).toBe(true);
    });

    it('escapes embedded newlines in the message so one entry stays one line', async () => {
        const { store, root } = await makeStore();
        store.append(undefined, 'info', 'line one\nline two\r\nline three');
        await store.close();

        const raw = await readFile(join(root, 'api.log'), 'utf8');
        const lines = raw.split('\n').filter(l => l.length > 0);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('line one\\nline two\\nline three');
    });

    it('never throws for a channel string that attempts path traversal', async () => {
        const { store, root } = await makeStore();
        expect(() => store.append('../../etc', 'info', 'should not escape root')).not.toThrow();
        await store.close();

        // The traversal attempt must have been sanitized into a subdirectory
        // under root, never having escaped it.
        const rootFiles = await readdir(root);
        expect(rootFiles).toContain(safeChannel('../../etc'));
    });

    it('surfaces a line that fails to parse instead of dropping it', async () => {
        const { store, root } = await makeStore();
        // Write a malformed line directly, bypassing formatLine.
        await writeFile(join(root, 'api.log'), 'not-a-well-formed-log-line\n', 'utf8');

        const entries = await store.tail(undefined);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toEqual({ ts: '', level: '', text: 'not-a-well-formed-log-line' });
    });
});

describe('RotatingLogStore.readAll', () => {
    it('returns the full content of a channel', async () => {
        const { store, root } = await makeStore();
        store.append(undefined, 'info', 'alpha');
        store.append(undefined, 'info', 'beta');
        await store.close();

        const reader = new RotatingLogStore({ root });
        openStores.push(reader);
        const content = await reader.readAll(undefined);
        expect(content).toContain('alpha');
        expect(content).toContain('beta');
        expect(content.indexOf('alpha')).toBeLessThan(content.indexOf('beta'));
    });

    it('returns an empty string for a channel that has never logged', async () => {
        const { store } = await makeStore();
        const content = await store.readAll('nothing-here');
        expect(content).toBe('');
    });
});

describe('RotatingLogStore.clear', () => {
    it('removes only files directly in root for the API channel, leaving plugin subdirectories intact', async () => {
        const { store, root } = await makeStore();
        store.append(undefined, 'info', 'api message');
        store.append('a-plugin', 'info', 'plugin message');
        await store.close();

        const reopened = new RotatingLogStore({ root });
        openStores.push(reopened);
        await reopened.clear(undefined);

        const rootFiles = await readdir(root, { withFileTypes: true });
        expect(rootFiles.some(e => e.isFile())).toBe(false);
        expect(rootFiles.some(e => e.isDirectory() && e.name === safeChannel('a-plugin'))).toBe(true);

        const pluginContent = await readFile(join(root, safeChannel('a-plugin'), 'plugin.log'), 'utf8');
        expect(pluginContent).toContain('plugin message');
    });

    it('removes the whole subdirectory for a plugin channel', async () => {
        const { store, root } = await makeStore();
        store.append('a-plugin', 'info', 'plugin message');
        await store.close();

        const reopened = new RotatingLogStore({ root });
        openStores.push(reopened);
        await reopened.clear('a-plugin');

        const rootFiles = await readdir(root);
        expect(rootFiles).not.toContain(safeChannel('a-plugin'));
    });

    it('does not throw when clearing a channel that never logged', async () => {
        const { store } = await makeStore();
        await expect(store.clear('never-logged')).resolves.toBeUndefined();
    });
});

describe('RotatingLogStore.close', () => {
    it('is safe to call twice', async () => {
        const { store } = await makeStore();
        store.append(undefined, 'info', 'hello');
        await store.close();
        await expect(store.close()).resolves.toBeUndefined();
    });

    it('still writes an append after close, synchronously, to the channel file', async () => {
        const { store, root } = await makeStore();
        await store.close();

        store.append(undefined, 'info', 'after close');

        // The synchronous write path means this is readable immediately,
        // with no `close()`/flush needed.
        const raw = await readFile(join(root, 'api.log'), 'utf8');
        expect(raw).toContain('after close');
    });

    it('round-trips a post-close append through tail and readAll', async () => {
        const { store, root } = await makeStore();
        store.append(undefined, 'info', 'before close');
        await store.close();
        store.append(undefined, 'info', 'after close');

        const reader = new RotatingLogStore({ root });
        openStores.push(reader);

        const tailed = await reader.tail(undefined);
        expect(tailed.map(e => e.text)).toEqual(['before close', 'after close']);

        const all = await reader.readAll(undefined);
        expect(all).toContain('before close');
        expect(all).toContain('after close');
    });

    it('does not repopulate the internal stream cache for an append after close', async () => {
        const { store } = await makeStore();
        await store.close();

        store.append(undefined, 'info', 'after close');

        const streams = (store as unknown as { streams: Map<string, unknown> }).streams;
        expect(streams.size).toBe(0);
    });

    it('resolves a second close cleanly even after a post-close append was attempted', async () => {
        const { store } = await makeStore();
        await store.close();
        store.append(undefined, 'info', 'still written');
        store.append('some-plugin', 'info', 'also still written');
        await expect(store.close()).resolves.toBeUndefined();
    });

    it("writes a post-close append for a plugin channel to that channel's own file", async () => {
        const { store, root } = await makeStore();
        await store.close();

        store.append('a-plugin', 'info', 'plugin line after close');

        const raw = await readFile(join(root, safeChannel('a-plugin'), 'plugin.log'), 'utf8');
        expect(raw).toContain('plugin line after close');
    });

    it('warns once per channel when a post-close write fails, and does not throw', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { store, root } = await makeStore();
        await store.close();

        // Occupy the target file path with a directory so the synchronous
        // write fails with a real fs error (EISDIR), instead of mocking `fs`.
        await mkdir(join(root, 'api.log'));
        warnSpy.mockClear();

        expect(() => store.append(undefined, 'info', 'first failing write')).not.toThrow();
        expect(() => store.append(undefined, 'info', 'second failing write')).not.toThrow();

        const failureWarnings = warnSpy.mock.calls.filter(call => String(call[0]).includes('failed to write post-close log entry'));
        expect(failureWarnings).toHaveLength(1);
    });
});

describe('RotatingLogStore rotation', () => {
    it('spans multiple rotated segments when tailing more than one active file holds', async () => {
        const { store, root } = await makeStore({ maxBytes: 200, maxFiles: 5 });

        for (let i = 0; i < 20; i++) {
            store.append(undefined, 'info', `entry-${i}-${'x'.repeat(20)}`);
        }
        await store.close();

        const files = await readdir(root);
        // rotating-file-stream names rotated segments distinctly from the active file.
        expect(files.length).toBeGreaterThan(1);

        const reader = new RotatingLogStore({ root });
        openStores.push(reader);
        const entries = await reader.tail(undefined, { limit: 100 });
        expect(entries.length).toBeGreaterThan(1);

        // Entries are collected across segments and must stay in ascending
        // write order end to end (oldest first, newest last).
        const indices = entries
            .map(e => /^entry-(\d+)-/.exec(e.text)?.[1])
            .filter((value): value is string => value !== undefined)
            .map(Number);
        expect(indices.length).toBeGreaterThan(0);
        for (let i = 1; i < indices.length; i++) {
            expect(indices[i]).toBeGreaterThan(indices[i - 1] as number);
        }
        expect(indices[indices.length - 1]).toBe(19);
    });

    it('caps segment growth at roughly maxFiles instead of retaining every rotation', async () => {
        const { store: tightStore, root: tightRoot } = await makeStore({ maxBytes: 200, maxFiles: 1 });
        const { store: looseStore, root: looseRoot } = await makeStore({ maxBytes: 200, maxFiles: 8 });

        for (let i = 0; i < 60; i++) {
            tightStore.append(undefined, 'info', `entry-${i}-${'x'.repeat(20)}`);
            looseStore.append(undefined, 'info', `entry-${i}-${'x'.repeat(20)}`);
        }
        await Promise.all([tightStore.close(), looseStore.close()]);

        const tightFiles = await readdir(tightRoot);
        const looseFiles = await readdir(looseRoot);

        // Both configurations rotate the same source, but retention with a
        // smaller maxFiles must not grow without bound relative to a larger one.
        expect(tightFiles.length).toBeLessThan(looseFiles.length);
        expect(tightFiles.length).toBeLessThan(60);
    });

    it('readAll returns segment contents in ascending order across a rotation', async () => {
        const { store, root } = await makeStore({ maxBytes: 200, maxFiles: 5 });

        for (let i = 0; i < 20; i++) {
            store.append(undefined, 'info', `entry-${i}-${'x'.repeat(20)}`);
        }
        await store.close();

        const reader = new RotatingLogStore({ root });
        openStores.push(reader);
        const content = await reader.readAll(undefined);
        const indices = Array.from(content.matchAll(/entry-(\d+)-/g)).map(m => Number(m[1]));
        expect(indices.length).toBeGreaterThan(1);
        for (let i = 1; i < indices.length; i++) {
            expect(indices[i]).toBeGreaterThan(indices[i - 1] as number);
        }
    });
});

describe('RotatingLogStore concurrent writes', () => {
    it('keeps every entry from a synchronous burst of appends, in issue order', async () => {
        const { store, root } = await makeStore();

        for (let i = 0; i < 50; i++) {
            store.append(undefined, 'info', `burst-${i}`);
        }
        await store.close();

        const reader = new RotatingLogStore({ root });
        openStores.push(reader);
        const entries = await reader.tail(undefined, { limit: 100 });
        expect(entries.map(e => e.text)).toEqual(Array.from({ length: 50 }, (_, i) => `burst-${i}`));
    });
});

describe('RotatingLogStore unwritable root', () => {
    it('does not throw and raises no unhandled rejection when root cannot be written', async () => {
        // A file, not a directory: rotating-file-stream cannot create paths under it.
        const parent = await mkdtemp(join(tmpdir(), 'deadair-log-store-unwritable-'));
        tempDirs.push(parent);
        const fileAsRoot = join(parent, 'not-a-directory');
        await writeFile(fileAsRoot, 'x', 'utf8');

        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown): void => {
            unhandled.push(reason);
        };
        process.on('unhandledRejection', onUnhandled);

        try {
            const store = new RotatingLogStore({ root: fileAsRoot });
            openStores.push(store);
            expect(() => store.append(undefined, 'info', 'should not throw')).not.toThrow();

            // Give the stream a chance to emit its 'error' event asynchronously.
            await new Promise(resolve => setTimeout(resolve, 50));
        } finally {
            process.off('unhandledRejection', onUnhandled);
        }

        expect(unhandled).toEqual([]);
    });
});

describe('safeChannel', () => {
    it('passes an already-safe id through unchanged', () => {
        expect(safeChannel('my-plugin.v2_test')).toBe('my-plugin.v2_test');
    });

    it('replaces disallowed characters with underscores and appends a hash suffix', () => {
        const result = safeChannel('weird plugin/id!');
        expect(result).toMatch(/^weird_plugin_id_-[0-9a-f]{8}$/);
    });

    it('treats "." and ".." as unsafe and falls back to an underscore plus hash', () => {
        expect(safeChannel('.')).toMatch(/^_-[0-9a-f]{8}$/);
        expect(safeChannel('..')).toMatch(/^_-[0-9a-f]{8}$/);
    });

    it('falls back to underscore plus hash for an id that sanitizes to empty', () => {
        expect(safeChannel('')).toMatch(/^_-[0-9a-f]{8}$/);
    });

    it('truncates ids longer than the channel length cap and appends a hash suffix', () => {
        const longId = 'a'.repeat(200);
        const result = safeChannel(longId);
        expect(result.startsWith('a'.repeat(80))).toBe(true);
        expect(result).toMatch(/^a{80}-[0-9a-f]{8}$/);
    });

    it('gives two different ids that sanitize to the same truncated prefix different suffixes', () => {
        const idOne = `${'a'.repeat(90)}-one`;
        const idTwo = `${'a'.repeat(90)}-two`;
        const resultOne = safeChannel(idOne);
        const resultTwo = safeChannel(idTwo);
        expect(resultOne).not.toBe(resultTwo);
    });

    it('is deterministic for the same input', () => {
        expect(safeChannel('weird plugin/id!')).toBe(safeChannel('weird plugin/id!'));
    });
});
