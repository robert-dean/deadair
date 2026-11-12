// `radio.liq` caps how far its streaming clock may fall behind before it drops the backlog rather
// than producing it as a burst (stream/latency.check.py). The cap has to sit under Icecast's
// `source-timeout`: a stall that long has already cost the source, the players that reconnect would
// take a burst on as delay for their whole session, and that delay is the fault the cap removes.
//
// Read as text because the two numbers live in two files and nothing else ties them together.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../../../../stream/${path}`, import.meta.url)), 'utf8');

const radioLiq = read('radio.liq');
const icecast = read('icecast.xml.tmpl');

describe('the streaming clock cap in radio.liq', () => {
    const cap = /^settings\.clock\.max_latency := max\(1\., env_float\("CLOCK_MAX_LATENCY_S", ([0-9.]+)\)\)$/m.exec(radioLiq);
    const timeout = /<source-timeout>([0-9]+)<\/source-timeout>/.exec(icecast);

    it('is declared, so a reworded line cannot pass this by matching nothing', () => {
        expect(cap).not.toBeNull();
        expect(timeout).not.toBeNull();
    });

    it("drops a stall before Icecast's source timeout would have dropped the source", () => {
        expect(Number(cap?.[1])).toBeLessThan(Number(timeout?.[1]));
    });

    it("is under Liquidsoap's own sixty seconds, which is what left listeners a minute behind", () => {
        expect(Number(cap?.[1])).toBeLessThan(60);
    });
});
