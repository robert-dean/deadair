// Icecast's burst is a number of BYTES, sized to be half a second of audio at the mount's nominal
// bitrate. That only holds while bytes and time stay in proportion, and variable bitrate Opus
// breaks the proportion exactly when it matters: measured on Liquidsoap 2.4.5, `blank()` encodes at
// about 220 bytes a second by default and about 20 KB a second with `vbr="none"` at 160 kbps. So a
// burst taken after an idle spell held tens of seconds of silence, and a listener joined that far
// behind live.
//
// Read as text because nothing else can catch it. Liquidsoap's `--check` passes any string here,
// `vbr="bogus"` included, and the encoder only refuses a bad value when it starts.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const radioLiq = readFileSync(fileURLToPath(new URL('../../../../../stream/radio.liq', import.meta.url)), 'utf8');

describe('the Opus encoder in radio.liq', () => {
    const encoders = [...radioLiq.matchAll(/%opus\(([^)]*)\)/g)].map(match => match[0]);

    it('is found at all, so a renamed encoder cannot pass this by matching nothing', () => {
        expect(encoders.length).toBeGreaterThan(0);
    });

    it.each(encoders)('states constant bitrate: %s', encoder => {
        expect(encoder).toContain('vbr="none"');
    });
});
