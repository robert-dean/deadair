/**
 * What the station's model calls and its speech cost, at prices the operator typed.
 *
 * Nothing in the station knew a price, so Trends could count tokens and say nothing about money,
 * which is the number a hosted model is actually chosen and argued about by
 * ([the leftovers](https://github.com/robert-dean/deadair/discussions/447)). **The prices are the
 * operator's rather than a table this repository ships**, because a shipped table is wrong the day a
 * provider changes one and nothing here would notice, while the operator holds the bill that says
 * what they actually pay. A model with no row is counted in tokens and not in money, which is the
 * honest reading of "nobody said".
 *
 * **A price is applied when the call is recorded, not when the chart is drawn.** `model.cost` is a
 * counter observed beside the tokens, so a month drawn later shows what that month cost at the
 * prices in force then, and changing a price moves only what comes after it. Read-time pricing
 * would have needed no new metric and would have rewritten the past on every edit.
 */

import type { AppConfig } from '@maroonedsoftware/appconfig';
import { parseRows } from '@deadair/plugin-sdk';

/** The `deadair.settings` keys. */
export const USAGE_PRICE_KEYS = {
    /** A list of `{model, input, output}` rows, prices per million tokens. */
    models: 'metrics.modelPrices',
    /** A list of `{engine, characters}` rows, prices per million characters spoken. */
    speech: 'metrics.speechPrices',
    /** The ISO 4217 code every price is in. Only the console reads it: the counters hold plain numbers. */
    currency: 'metrics.currency',
} as const;

/** The columns of {@link USAGE_PRICE_KEYS.models}. */
export const MODEL_PRICE_COLUMNS = { model: 'model', input: 'input', output: 'output' } as const;

/** The columns of {@link USAGE_PRICE_KEYS.speech}. */
export const SPEECH_PRICE_COLUMNS = { engine: 'engine', characters: 'characters' } as const;

/** US dollars, which is what every hosted model this station reaches bills in. */
export const DEFAULT_USAGE_CURRENCY = 'USD';

/** One model's price, per million tokens. An absent side costs nothing. */
export interface ModelPrice {
    inputPerMillion: number;
    outputPerMillion: number;
}

/**
 * A price cell as a number, or `undefined` for one that is empty or is not a price.
 *
 * A cell is text, like every setting. `1,50` and `-3` are mistakes, and a mistake counts as no price
 * rather than as zero, so a typo shows as a model with no cost instead of a free one.
 */
export function priceCell(raw: string | undefined): number | undefined {
    if (raw === undefined) return undefined;
    const value = raw.trim().replace(/^[$€£]/, '');
    if (!/^\d+(\.\d+)?$|^\.\d+$/.test(value)) return undefined;
    return Number(value);
}

/**
 * The prices by model, over a raw stored value.
 *
 * A row needs a model and at least one readable price; the other side is then free, which is how a
 * provider that bills only output reads. A model listed twice keeps its first row, as a model list
 * does.
 */
export function readModelPrices(raw: unknown): Map<string, ModelPrice> {
    const prices = new Map<string, ModelPrice>();

    for (const row of parseRows(raw)) {
        const model = row[MODEL_PRICE_COLUMNS.model];
        if (model === undefined || prices.has(model)) continue;

        const input = priceCell(row[MODEL_PRICE_COLUMNS.input]);
        const output = priceCell(row[MODEL_PRICE_COLUMNS.output]);
        if (input === undefined && output === undefined) continue;

        prices.set(model, { inputPerMillion: input ?? 0, outputPerMillion: output ?? 0 });
    }

    return prices;
}

/** {@link readModelPrices} over the live config. */
export function modelPrices(config: AppConfig): Map<string, ModelPrice> {
    return readModelPrices(config.get(USAGE_PRICE_KEYS.models, ''));
}

/**
 * What one call cost, or `undefined` when it cannot be said.
 *
 * Reasoning tokens are not added: every provider counts them inside the output figure
 * (`LlmUsage.reasoningTokens` is "how much of outputTokens"), so adding them would bill the thinking
 * twice. A call that reported no tokens at all has no cost either, rather than a cost of nothing.
 */
export function callCost(price: ModelPrice | undefined, inputTokens: number | undefined, outputTokens: number | undefined): number | undefined {
    if (price === undefined) return undefined;
    if (inputTokens === undefined && outputTokens === undefined) return undefined;
    return ((inputTokens ?? 0) * price.inputPerMillion + (outputTokens ?? 0) * price.outputPerMillion) / 1_000_000;
}

/**
 * The price per million characters by speech engine, over a raw stored value.
 *
 * Characters rather than seconds of audio, because that is what a hosted engine bills: ElevenLabs
 * counts the text it was handed against the plan. A self-hosted engine has no row and is counted in
 * characters only. An engine listed twice keeps its first row.
 */
export function readSpeechPrices(raw: unknown): Map<string, number> {
    const prices = new Map<string, number>();

    for (const row of parseRows(raw)) {
        const engine = row[SPEECH_PRICE_COLUMNS.engine];
        const price = priceCell(row[SPEECH_PRICE_COLUMNS.characters]);
        if (engine === undefined || price === undefined || prices.has(engine)) continue;
        prices.set(engine, price);
    }

    return prices;
}

/** {@link readSpeechPrices} over the live config. */
export function speechPrices(config: AppConfig): Map<string, number> {
    return readSpeechPrices(config.get(USAGE_PRICE_KEYS.speech, ''));
}
