import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { BreakWriter } from './break.writer.js';
import { MODEL_WRITER } from './model.talk.break.writer.js';

/**
 * Which of a kind's writers is asked first: the model, or the station's own words.
 *
 * Registration order in `director.module.ts` puts the model in front and the station's own words
 * (the persona's phrasings, the headline as published, the operator's prose) behind it as the floor.
 * That is right for a station that turned the model on to be heard. An operator who wants the
 * phrasings on air and the model only where they have nothing to say wants the same two writers the
 * other way round, which is a reordering of one list rather than a second registry, so this is a
 * setting the registry reads per write and nothing about its shape moves.
 *
 * `station` does not switch the model off. With the station's words in front, the model is asked
 * only when they decline, which for a talk break is a pair of records nothing true can be said
 * about. Switching it off is still `llm.breakWriter`.
 */

/** The orders an operator can choose. Its own vocabulary, so it is also what is stored. */
export const WRITER_ORDERS = ['model', 'station'] as const;

export type WriterOrder = (typeof WRITER_ORDERS)[number];

export const WRITER_ORDER_KEY = 'llm.breakWriterOrder';

/** The model first, which is what every station did before this was a setting. */
export const DEFAULT_WRITER_ORDER: WriterOrder = 'model';

/** Whether a stored value is one of the orders. Anything else takes the default, on `settingIsOn`'s rule. */
export function isWriterOrder(value: unknown): value is WriterOrder {
    return typeof value === 'string' && (WRITER_ORDERS as readonly string[]).includes(value);
}

/** The station's own order, from its settings. A value nobody can parse is a setting nobody set. */
export function resolveWriterOrder(config: AppConfig): WriterOrder {
    const stored = String(config.get(WRITER_ORDER_KEY, DEFAULT_WRITER_ORDER) ?? '').trim();
    return isWriterOrder(stored) ? stored : DEFAULT_WRITER_ORDER;
}

/**
 * A kind's writers in the order they are asked.
 *
 * `model` is the registration order unchanged. `station` moves every model binding behind the
 * writers with no model in them, keeping each side's own order, so a kind with one writer, or with
 * no model in front of it (the warm-up, the jingle), comes back exactly as it went in.
 */
export function inWriterOrder<T extends Pick<BreakWriter, 'name'>>(writers: readonly T[], order: WriterOrder): T[] {
    if (order === 'model') return [...writers];

    return [...writers.filter(writer => writer.name !== MODEL_WRITER), ...writers.filter(writer => writer.name === MODEL_WRITER)];
}
