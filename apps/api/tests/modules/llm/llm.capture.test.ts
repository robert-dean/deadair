// A capture is a file because it was a log line first, and the log store truncated it at 512
// characters — so the first capture of the failure it was written for arrived as two rules of a
// system prompt and an ellipsis. What is worth pinning here is that the whole thing survives, and
// that leaving the switch on overnight cannot fill a disk.

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import { MAX_CAPTURES, writeCapture } from '../../../src/modules/llm/llm.capture.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

let root: string;

const configFor = (dir: string) => ({ get: (key: string, fallback: unknown) => (key === 'LOGS_DIR' ? dir : fallback) }) as unknown as AppConfig;

/** A capture with a body far past what a log line would carry. */
const capture = (answer = '[]') => ({
    kind: 'set',
    context: { asked: 24, named: 0 },
    transcript: [
        { role: 'system' as const, content: 'You are programming the music for a radio station.' },
        { role: 'tool' as const, toolCallId: 'call_1', content: JSON.stringify(Array.from({ length: 200 }, (_, index) => ({ title: `T${index}` }))) },
    ],
    answer,
});

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-capture-'));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('writeCapture', () => {
    it('keeps the whole conversation, which is the thing a log line could not', async () => {
        const path = await writeCapture(configFor(root), logger, capture(), 1_700_000_000_000);

        expect(path).toBeDefined();
        const written = JSON.parse(await readFile(path!, 'utf8'));
        expect(written.transcript).toHaveLength(2);
        // The tool result is thousands of characters and arrives whole.
        expect(written.transcript[1].content.length).toBeGreaterThan(2_000);
        expect(written.answer).toBe('[]');
        expect(written.context).toEqual({ asked: 24, named: 0 });
    });

    it('names the file so it sorts by time, because the prune orders by name', async () => {
        const path = await writeCapture(configFor(root), logger, capture(), Date.parse('2026-08-15T18:28:57.000Z'));

        expect(path).toContain('set-2026-08-15T18-28-57');
    });

    it('keeps only the newest, so a switch left on overnight cannot fill a disk', async () => {
        for (let index = 0; index < MAX_CAPTURES + 5; index++) {
            await writeCapture(configFor(root), logger, capture(), 1_700_000_000_000 + index * 1_000);
        }

        expect(await readdir(join(root, 'captures'))).toHaveLength(MAX_CAPTURES);
    });

    it('drops the oldest rather than the newest, which are the ones worth reading', async () => {
        for (let index = 0; index < MAX_CAPTURES + 1; index++) {
            await writeCapture(configFor(root), logger, capture(), Date.parse('2026-08-15T00:00:00.000Z') + index * 60_000);
        }

        const kept = await readdir(join(root, 'captures'));
        expect(kept.some(name => name.includes('T00-00-00'))).toBe(false);
        expect(kept.some(name => name.includes(`T00-${String(MAX_CAPTURES).padStart(2, '0')}-00`))).toBe(true);
    });

    it('answers with nothing rather than throwing when it cannot write', async () => {
        // A station that stopped programming because it could not write a transcript would be a
        // worse bug than the one this exists to diagnose.
        const path = await writeCapture(configFor('/dev/null/nowhere'), logger, capture(), 1_700_000_000_000);

        expect(path).toBeUndefined();
        expect(logger.warn).toHaveBeenCalled();
    });
});
