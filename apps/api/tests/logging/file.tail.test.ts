import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readFileTail, tailFileLines } from '../../src/logging/file.tail.js';

const tempDirs: string[] = [];

/** Writes `content` into a fresh temp directory and answers the file's path. */
async function fileHolding(content: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'deadair-file-tail-test-'));
    tempDirs.push(dir);
    const path = join(dir, 'sample.log');
    await writeFile(path, content, 'utf8');
    return path;
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('readFileTail', () => {
    it('answers undefined for a file that is not there', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'deadair-file-tail-test-'));
        tempDirs.push(dir);

        expect(await readFileTail(join(dir, 'never-written.log'), 1024)).toBeUndefined();
    });

    it('reads a file shorter than the budget whole, and does not call it truncated', async () => {
        const path = await fileHolding('first\nsecond\nthird\n');

        expect(await readFileTail(path, 1024)).toEqual({ text: 'first\nsecond\nthird\n', truncated: false });
    });

    it('reads only the end of a file longer than the budget, and says the head was cut', async () => {
        // Twenty 9-byte lines (180 bytes), of which a 55-byte budget holds the last six whole.
        const lines = Array.from({ length: 20 }, (_, index) => `line-${String(index).padStart(3, '0')}`);
        const path = await fileHolding(`${lines.join('\n')}\n`);

        const tail = await readFileTail(path, 55);

        expect(tail?.truncated).toBe(true);
        expect(tail?.text).toBe('line-014\nline-015\nline-016\nline-017\nline-018\nline-019\n');
    });

    it('drops the partial line the seek landed in the middle of', async () => {
        const path = await fileHolding('aaaaaaaaaa\nbbbbbbbbbb\n');

        // 15 bytes back from the end starts inside `bbbbbbbbbb`'s preceding line, so the fragment
        // of it must not be reported as a line the process wrote.
        const tail = await readFileTail(path, 15);

        expect(tail).toEqual({ text: 'bbbbbbbbbb\n', truncated: true });
    });

    it('answers empty text when the budget lands inside a single unbroken line', async () => {
        const path = await fileHolding(`${'x'.repeat(500)}\n`);

        expect(await readFileTail(path, 20)).toEqual({ text: '', truncated: true });
    });

    it('reads an empty file as empty rather than as absent', async () => {
        const path = await fileHolding('');

        expect(await readFileTail(path, 1024)).toEqual({ text: '', truncated: false });
    });

    it('keeps a final line that has no trailing newline', async () => {
        const path = await fileHolding('first\nsecond');

        expect(await readFileTail(path, 1024)).toEqual({ text: 'first\nsecond', truncated: false });
    });
});

describe('tailFileLines', () => {
    it('answers newest first', async () => {
        const path = await fileHolding('oldest\nmiddle\nnewest\n');

        expect(await tailFileLines(path, { maxBytes: 1024, limit: 10 })).toEqual({
            lines: ['newest', 'middle', 'oldest'],
            truncated: false,
        });
    });

    it('takes the newest `limit` lines rather than the first it read', async () => {
        const path = await fileHolding('one\ntwo\nthree\nfour\nfive\n');

        const tail = await tailFileLines(path, { maxBytes: 1024, limit: 2 });

        expect(tail.lines).toEqual(['five', 'four']);
    });

    it('carries a truncated read through to the caller', async () => {
        const lines = Array.from({ length: 40 }, (_, index) => `line-${String(index).padStart(3, '0')}`);
        const path = await fileHolding(`${lines.join('\n')}\n`);

        const tail = await tailFileLines(path, { maxBytes: 60, limit: 100 });

        expect(tail.truncated).toBe(true);
        expect(tail.lines[0]).toBe('line-039');
        expect(tail.lines.length).toBeLessThan(40);
    });

    it('answers an empty list for a file that is not there', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'deadair-file-tail-test-'));
        tempDirs.push(dir);

        expect(await tailFileLines(join(dir, 'absent.log'), { maxBytes: 1024, limit: 10 })).toEqual({ lines: [], truncated: false });
    });

    it('drops the blank the trailing newline leaves behind', async () => {
        const path = await fileHolding('only\n');

        expect((await tailFileLines(path, { maxBytes: 1024, limit: 10 })).lines).toEqual(['only']);
    });
});
