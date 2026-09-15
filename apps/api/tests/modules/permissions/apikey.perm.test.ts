// The `apikey` namespace is the whole of the rule that a key never exceeds its owner, so it is
// tested as a model, against the real `core.perm`, rather than through the services that consume
// it. The fixture beside this file names every case; this runs it and reports each failure by the
// line it was written on.

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadFixture, runFixture } from '@maroonedsoftware/permissions-dsl';

const FIXTURE = fileURLToPath(new URL('./apikey.perm.yaml', import.meta.url));

describe('the apikey namespace', () => {
    it('holds every assertion in its fixture', async () => {
        const report = await runFixture(await loadFixture(FIXTURE));

        const failures = report.results
            .filter(result => !result.pass)
            .map(result => `line ${result.line}: ${result.text} (${result.message ?? 'failed'})`);
        expect(failures).toEqual([]);
        expect(report.summary.passed).toBeGreaterThan(0);
    });
});
