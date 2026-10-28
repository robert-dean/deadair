// Prices are typed by an operator into a list setting, so every cell is text: what is pinned is that a
// mistake reads as no price rather than as a free model, and that a call is priced on the output figure
// alone, since that already holds the thinking.

import { describe, expect, it } from 'vitest';

import { callCost, modelPrices, priceCell, readModelPrices, readSpeechPrices, USAGE_PRICE_KEYS } from '../../../src/modules/metrics/usage.prices.js';
import type { AppConfig } from '@maroonedsoftware/appconfig';

const rows = (...entries: Record<string, string>[]) => JSON.stringify(entries);

describe('priceCell', () => {
    it('reads a plain figure, with or without a currency sign in front', () => {
        expect(priceCell('3')).toBe(3);
        expect(priceCell(' 0.25 ')).toBe(0.25);
        expect(priceCell('.5')).toBe(0.5);
        expect(priceCell('$15.00')).toBe(15);
    });

    it('reads a mistake as no price, never as zero', () => {
        for (const raw of ['', '  ', '1,50', '-3', 'three', '3.', 'NaN', 'Infinity', undefined]) expect(priceCell(raw)).toBeUndefined();
    });
});

describe('readModelPrices', () => {
    it('keeps a row by its model, with a missing side as free', () => {
        const prices = readModelPrices(rows({ model: 'cloud:sonnet', input: '3', output: '15' }, { model: 'cloud:flash', output: '0.4' }));

        expect(prices.get('cloud:sonnet')).toEqual({ inputPerMillion: 3, outputPerMillion: 15 });
        expect(prices.get('cloud:flash')).toEqual({ inputPerMillion: 0, outputPerMillion: 0.4 });
    });

    it('drops a row with no model or no readable price, and keeps the first of a model listed twice', () => {
        const prices = readModelPrices(
            rows({ input: '3', output: '15' }, { model: 'a', input: 'lots' }, { model: 'b', input: '1' }, { model: 'b', input: '9' }),
        );

        expect([...prices.keys()]).toEqual(['b']);
        expect(prices.get('b')?.inputPerMillion).toBe(1);
    });

    it('reads nothing from an empty or unreadable value', () => {
        expect(readModelPrices('').size).toBe(0);
        expect(readModelPrices('not json').size).toBe(0);
        expect(readModelPrices(undefined).size).toBe(0);
    });

    it('reads the live setting', () => {
        const config = { get: (key: string, fallback: string) => (key === USAGE_PRICE_KEYS.models ? rows({ model: 'm', input: '2' }) : fallback) };
        expect(modelPrices(config as unknown as AppConfig).get('m')?.inputPerMillion).toBe(2);
    });
});

describe('callCost', () => {
    const price = { inputPerMillion: 3, outputPerMillion: 15 };

    it('prices both sides per million', () => {
        expect(callCost(price, 2000, 100)).toBeCloseTo(0.0075);
    });

    it('prices one side when only one was reported', () => {
        expect(callCost(price, undefined, 1_000_000)).toBeCloseTo(15);
    });

    it('says nothing without a price, or for a call that reported no tokens', () => {
        expect(callCost(undefined, 100, 100)).toBeUndefined();
        expect(callCost(price, undefined, undefined)).toBeUndefined();
    });
});

describe('readSpeechPrices', () => {
    it('keeps a price per engine, and drops a row with no engine or no readable price', () => {
        const prices = readSpeechPrices(
            rows(
                { engine: 'deadair.elevenlabs', characters: '150' },
                { engine: 'deadair.kokoro' },
                { characters: '9' },
                { engine: 'x', characters: 'free' },
            ),
        );

        expect([...prices.entries()]).toEqual([['deadair.elevenlabs', 150]]);
    });
});
