import type { AppConfig } from '@maroonedsoftware/appconfig';

/**
 * Reading an on/off setting, which is not the same as reading it as a boolean.
 *
 * ## Why this exists
 *
 * **Every layer of `AppConfig` stores strings.** `AppConfigSourcePostgres.load()` puts each
 * `deadair.settings` row into the snapshot as the raw text of its `value` column and parses nothing
 * — its `tryParseJson` is used only by the single-key `get()` behind a `${pg:…}` reference, which is
 * not the path a module read takes. dotenv is the same by construction. So a setting the registry
 * declares as `boolean` and the console writes as `true`/`false` arrives here as the STRING
 * `'true'` or `'false'`.
 *
 * And `'false'` is truthy. That is the entire bug: `config.get(key, false)` reads as `true` whatever
 * the operator chose, so every switch written that way could be turned on and never back off, in
 * silence — the console showed the change, the settings table held it, and the feature ignored it.
 * There is no version of this that fails loudly, because the wrong answer is a perfectly ordinary
 * boolean.
 *
 * ## Why a helper rather than a ternary at each site
 *
 * Three call sites had already worked it out independently and written three different coercions —
 * `=== 'true'`, `!== 'false'`, and a `Number.parseInt` for the numeric cousins — which is the shape
 * of a rule that is genuinely easy to get wrong and easy to forget. A new setting is added by
 * copying an existing one, so the only durable fix is that the thing being copied is right.
 *
 * ## What counts as on
 *
 * More than `'true'`, deliberately. The console only ever writes `true`/`false`, but a `.env` file
 * is written by hand and `OTP_DEV_BYPASS=1` is a thing people type. The generous set costs nothing
 * and the alternative is a switch that reads as off because its operator used the wrong word for
 * yes.
 *
 * **An unreadable value takes the DEFAULT rather than `false`.** A setting nobody can parse is a
 * setting nobody set, and the registry's default is the considered answer for that; falling to
 * `false` would silently switch off a feature that ships on.
 *
 * @param config - Read per call rather than captured, so an operator's edit applies without a
 *   restart. The store's `LISTEN` is what makes that true.
 * @param key - The `deadair.settings` key, or a dotenv name.
 * @param fallback - The registry's declared default for that key, so the two cannot disagree.
 */
export function settingIsOn(config: AppConfig, key: string, fallback: boolean): boolean {
    return flagIsOn(config.get(key, fallback), fallback);
}

/**
 * The same question asked of a value already in hand.
 *
 * {@link settingIsOn} is how a module reads a switch and this is the vocabulary underneath it,
 * separated out because the CONSOLE has to answer the identical question from a different place:
 * `parseSetting` renders a stored row into the settings form without going through `AppConfig` at
 * all. While that was its own coercion the two disagreed, which is the one failure mode a settings
 * form has — the console said a feature was on, the module read it as off, and both were reporting
 * the same row honestly. Anything else that has to turn a stored string into a switch belongs here
 * too rather than writing a fifth `!== 'false'`.
 *
 * @param raw - Whatever the value arrived as: a string from a column or a file, or a real boolean
 *   from a default or a test.
 * @param fallback - The registry's declared default, which is the answer for a value that means
 *   neither yes nor no.
 */
export function flagIsOn(raw: unknown, fallback: boolean): boolean {
    // A layer that genuinely held a boolean, which is every default on this path and every test
    // that hands one over. Checked first so the string handling below is only ever reached by a
    // value that came out of a database or a file.
    if (typeof raw === 'boolean') return raw;

    const text = String(raw).trim().toLowerCase();
    if (ON.has(text)) return true;
    if (OFF.has(text)) return false;

    // Includes the empty string, which is what a row cleared through the console leaves behind: not
    // an answer, so it takes the declared one.
    return fallback;
}

/** The words that mean yes, lowercased. */
const ON = new Set(['true', '1', 'yes', 'on']);

/** The words that mean no. `'false'` is the one this whole file exists for. */
const OFF = new Set(['false', '0', 'no', 'off']);
