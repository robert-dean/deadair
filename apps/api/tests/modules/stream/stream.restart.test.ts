// The request is a file whose mtime the container watches, so what matters is that every request
// lands whole and moves the mtime, and that a request with nowhere to go says so instead of throwing
// into a timer with nobody to catch it.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import { AUDIO_CHAIN_RESTART_FILE, AudioChainRestart } from '../../../src/modules/stream/stream.restart.js';

describe('AudioChainRestart', () => {
    let dir: string;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
    const configFor = (configDir: string) =>
        ({ get: vi.fn((key: string, fallback: unknown) => (key === 'STREAM_CONFIG_DIR' ? configDir : fallback)) }) as unknown as AppConfig;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'deadair-restart-'));
        vi.mocked(logger.warn).mockClear();
    });

    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('writes the request beside the rendered config, with when and why', () => {
        const written = new AudioChainRestart(configFor(dir), logger).request('holdingNotPlaying', new Date('2026-09-13T21:13:45.000Z'));

        expect(written).toBe(true);
        expect(readFileSync(join(dir, AUDIO_CHAIN_RESTART_FILE), 'utf8')).toBe('2026-09-13T21:13:45.000Z holdingNotPlaying\n');
    });

    it('replaces the last request rather than appending to it, and leaves nothing half-written behind', () => {
        const restart = new AudioChainRestart(configFor(dir), logger);
        restart.request('holdingNotPlaying', new Date('2026-09-13T21:13:45.000Z'));
        restart.request('notAnswering', new Date('2026-09-13T21:18:45.000Z'));

        expect(readFileSync(join(dir, AUDIO_CHAIN_RESTART_FILE), 'utf8')).toBe('2026-09-13T21:18:45.000Z notAnswering\n');
        expect(readdirSync(dir)).toEqual([AUDIO_CHAIN_RESTART_FILE]);
    });

    it('answers false and says why when there is nowhere to write it', () => {
        const written = new AudioChainRestart(configFor(join(dir, 'missing')), logger).request('notAnswering');

        expect(written).toBe(false);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('could not ask for the audio chain to be restarted'), expect.anything());
    });
});
