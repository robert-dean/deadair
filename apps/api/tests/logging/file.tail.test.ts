import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { measureSegments, readFileTail, readSegmentedTail, tailFileLines } from '../../src/logging/file.tail.js';

const tempDirs: string[] = [];

/** Writes `content` into a fresh temp directory and answers the file's path. */
async function fileHolding(content: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'deadair-file-tail-test-'));
    tempDirs.push(dir);
    const path = join(dir, 'sample.log');
    await writeFile(path, content, 'utf8');
    return path;
}

/**
 * Writes a rotated set and answers the ACTIVE file's path.
 *
 * `segments` is given newest first, the way an operator reads them: index 0 is `sample.log`, index
 * 1 is `sample.log.1`, and so on. `undefined` writes no file at that index, which is how the
 * missing-active-file case is set up.
 */
async function segmentsHolding(segments: (string | undefined)[]): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'deadair-file-tail-test-'));
    tempDirs.push(dir);
    const path = join(dir, 'sample.log');

    for (const [index, content] of segments.entries()) {
        if (content === undefined) continue;
        await writeFile(index === 0 ? path : `${path}.${index}`, content, 'utf8');
    }

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

    it('reads back across rotated segments, so a fresh rotation does not empty the console', async () => {
        // The state a rotation leaves a minute later: almost nothing in the active file, and the
        // history an operator is looking for in the segment behind it.
        const path = await segmentsHolding(['newest\n', 'oldest\nolder\n']);

        expect(await tailFileLines(path, { maxBytes: 1024, limit: 10 })).toEqual({
            lines: ['newest', 'older', 'oldest'],
            truncated: false,
        });
    });
});

describe('readSegmentedTail', () => {
    it('reads one unrotated file exactly as a plain tail does', async () => {
        const path = await fileHolding('first\nsecond\n');

        expect(await readSegmentedTail(path, 1024)).toEqual({ text: 'first\nsecond\n', truncated: false });
    });

    it('answers undefined when neither the active file nor any segment is there', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'deadair-file-tail-test-'));
        tempDirs.push(dir);

        expect(await readSegmentedTail(join(dir, 'never-written.log'), 1024)).toBeUndefined();
    });

    it('joins the segments oldest first, so the result reads as the one file it was', async () => {
        const path = await segmentsHolding(['five\nsix\n', 'three\nfour\n', 'one\ntwo\n']);

        expect(await readSegmentedTail(path, 1024)).toEqual({
            text: 'one\ntwo\nthree\nfour\nfive\nsix\n',
            truncated: false,
        });
    });

    it('goes on past a missing ACTIVE file, because the retained segments are still the log', async () => {
        const path = await segmentsHolding([undefined, 'older\n', 'oldest\n']);

        expect(await readSegmentedTail(path, 1024)).toEqual({ text: 'oldest\nolder\n', truncated: false });
    });

    it('stops at a missing SEGMENT, because they are numbered contiguously', async () => {
        // `.2` is absent, so `.3` is past the end of this set and must not be read even though a
        // file by that name exists.
        const path = await segmentsHolding(['newest\n', 'second\n', undefined, 'stranger\n']);

        expect(await readSegmentedTail(path, 1024)).toEqual({ text: 'second\nnewest\n', truncated: false });
    });

    it('spends the budget newest first and says the oldest line is not the oldest retained', async () => {
        const path = await segmentsHolding(['ccc\nddd\n', 'aaa\nbbb\n', 'way-older\n']);

        // 8 bytes take the active file whole, and the 5 left reach back into `.1` far enough to
        // land inside `aaa`, whose fragment is dropped. `.2` is never opened.
        const tail = await readSegmentedTail(path, 13);

        expect(tail?.truncated).toBe(true);
        expect(tail?.text).toBe('bbb\nccc\nddd\n');
    });

    it('calls a set truncated when the budget ran out exactly on a segment boundary', async () => {
        // The budget covers the active file to the byte, so nothing is cut mid-line — but there is
        // older history and none of it fits, which is what `truncated` is for.
        const path = await segmentsHolding(['ccc\nddd\n', 'aaa\nbbb\n']);

        expect(await readSegmentedTail(path, 8)).toEqual({ text: 'ccc\nddd\n', truncated: true });
    });

    it('does not call an empty older segment truncation, and reads past it', async () => {
        const path = await segmentsHolding(['newest\n', '', 'oldest\n']);

        expect(await readSegmentedTail(path, 1024)).toEqual({ text: 'oldest\nnewest\n', truncated: false });
    });
});

describe('measureSegments', () => {
    it('answers undefined when nothing of the set is there', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'deadair-file-tail-test-'));
        tempDirs.push(dir);

        expect(await measureSegments(join(dir, 'absent.log'))).toBeUndefined();
    });

    it('sums every segment, so the size shown is what the set costs the disk', async () => {
        const path = await segmentsHolding(['12345\n', '1234567890\n', '1\n']);

        expect((await measureSegments(path))?.bytes).toBe(6 + 11 + 2);
    });

    it('counts an empty active file as present rather than absent', async () => {
        const path = await segmentsHolding(['']);

        expect((await measureSegments(path))?.bytes).toBe(0);
    });

    it('stops at a missing segment on the same rule the read does', async () => {
        const path = await segmentsHolding(['12345\n', undefined, '1234567890\n']);

        expect((await measureSegments(path))?.bytes).toBe(6);
    });
});
