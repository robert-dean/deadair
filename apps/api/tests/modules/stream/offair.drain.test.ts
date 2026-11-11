// After a stand-down `radio.liq` plays out what the cross is still holding, unheard, for at most
// `playout_drain_s`. The cross holds up to the longest blend the app stamps, so a ceiling at or
// under it would cut the drain short and leave the rest of the old record's tail for the next
// listener, which is the fault the drain exists to remove (stream/offair.check.py).
//
// Read as text because the two numbers live in two languages and nothing else ties them together.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { MAX_BLEND_MS } from '../../../src/modules/playout/crossfade.js';

const radioLiq = readFileSync(fileURLToPath(new URL('../../../../../stream/radio.liq', import.meta.url)), 'utf8');

describe('the stand-down drain in radio.liq', () => {
    const declared = /^playout_drain_s = ([0-9.]+)$/m.exec(radioLiq);

    it('is declared, so a renamed constant cannot pass this by matching nothing', () => {
        expect(declared).not.toBeNull();
    });

    it('outlasts the longest blend the cross can be holding', () => {
        expect(Number(declared?.[1]) * 1000).toBeGreaterThan(MAX_BLEND_MS);
    });

    it('is started by the stand-down', () => {
        const offair = /def control_offair\(req\) =[\s\S]*?\nend\n/.exec(radioLiq)?.[0] ?? '';
        expect(offair).toContain('playout_drain_left := playout_drain_s');
        expect(offair).toContain('stand_down_voice()');
    });
});
