// The `oauthgrant` namespace is the whole of the rule that a connected app never exceeds the person
// who approved it, so it is tested as a model, against the real `core.perm`, as the `apikey` one is.

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadFixture, runFixture } from '@maroonedsoftware/permissions-dsl';

const FIXTURE = fileURLToPath(new URL('./oauthgrant.perm.yaml', import.meta.url));

describe('the oauthgrant namespace', () => {
    it('holds every assertion in its fixture', async () => {
        const report = await runFixture(await loadFixture(FIXTURE));

        const failures = report.results
            .filter(result => !result.pass)
            .map(result => `line ${result.line}: ${result.text} (${result.message ?? 'failed'})`);
        expect(failures).toEqual([]);
        expect(report.summary.passed).toBeGreaterThan(0);
    });
});
