// Which question each constant answers. A reader handed the CURRENT version loses every measurement
// the moment the schema moves on, so what is pinned is that only the walk ever reads that one, however
// many readers are added later. The two are equal today, so no assertion on a value could tell them apart.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANALYSIS_READABLE_SINCE_VERSION, ANALYSIS_SCHEMA_VERSION } from '@deadair/plugin-sdk';
import { describe, expect, it } from 'vitest';

const SOURCE = join(import.meta.dirname, '../../../src');

function filesUnder(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return filesUnder(path);
        return path.endsWith('.ts') ? [path] : [];
    });
}

describe('the analysis schema versions', () => {
    it('leaves the current version to the walk alone', () => {
        const readers = filesUnder(SOURCE)
            .filter(path => readFileSync(path, 'utf8').includes('ANALYSIS_SCHEMA_VERSION'))
            .map(path => path.slice(SOURCE.length + 1));

        expect(readers).toEqual(['modules/analysis/analysis.service.ts']);
    });

    it('never reads a failure row, which is stored as version 0', () => {
        expect(ANALYSIS_READABLE_SINCE_VERSION).toBeGreaterThan(0);
    });

    it('never asks for a version no analyzer writes yet', () => {
        expect(ANALYSIS_READABLE_SINCE_VERSION).toBeLessThanOrEqual(ANALYSIS_SCHEMA_VERSION);
    });
});
