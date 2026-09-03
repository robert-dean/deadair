import { z } from 'zod';

/**
 * The kinds of input a plugin can ask the operator for.
 *
 * - `string`      free text, one line
 * - `text`        free text over several lines, for anything a person writes
 *                 rather than pastes: a prompt, a persona, a list of phrasings.
 *                 Stored exactly like a `string`, so nothing downstream has to
 *                 know it exists; the difference is the box the operator types
 *                 into, and a one-line box for a paragraph is the reason a
 *                 setting like that ends up being edited by hand in psql
 * - `url`         free text validated/normalised as a URL
 * - `secret`      write-only: the host encrypts it, the settings UI never reads
 *                 it back, and only `host.secrets.get()` sees the plaintext
 * - `number`      numeric input
 * - `boolean`     toggle
 * - `select`      one of `options`
 * - `multiselect` any number of `options`, stored as a JSON array of the chosen
 *                 values. Read it back with {@link parseMultiSelect}
 * - `list`        any number of ROWS with the same `columns`, stored as a JSON
 *                 array of objects. Read it back with {@link parseRows}. For a
 *                 list whose entries have parts — a feed with a name and a
 *                 category — where the alternative is a `text` field with a
 *                 separator in it and a line an operator can mistype into
 *                 silence
 * - `note`        not an input at all: static help text rendered in the form
 */
export type ConfigFieldType = 'string' | 'text' | 'url' | 'secret' | 'number' | 'boolean' | 'select' | 'multiselect' | 'list' | 'note';

/**
 * What a `number` field's value is measured in, so the form can offer a control a person can use.
 *
 * The VALUE is always stored in the unit named here — `bytes` means the row holds bytes — and the
 * console converts on the way in and out. That is the whole point: a byte count is the right thing
 * for code to compare against and a terrible thing to type, and the alternative to declaring it is
 * either storing a friendlier unit (and doing the multiplication at every reader) or special-casing
 * a particular setting key inside the form, which is the kind of thing nobody finds later.
 *
 * `fraction` is the second member and the one the first paragraph predicted: the row holds a share
 * between 0 and 1, because that is what the code multiplying by it wants, and the console says
 * `40%`, because that is what a person means. Honoured by a `slider`, which is the control every
 * share in this station asks for; a fraction drawn as an ordinary spinner is still shown as the
 * fraction it stores, since a number typed exactly is unambiguous either way.
 *
 * An enum rather than a boolean because the third member is obvious (a duration in milliseconds has
 * exactly the same problem) and because a closed set is what the contract mirroring this can
 * express.
 */
export type ConfigFieldUnit = 'bytes' | 'fraction';

/**
 * The control a field asks for, where the default one for its type is not the readable one.
 *
 * {@link ConfigFieldUnit}'s sibling, and the same bargain: what is STORED does not change, only the
 * thing the operator touches. A `slider` over a share between 0 and 1 stores a fraction, and every
 * reader still reads a fraction.
 *
 * Opt-in per field rather than inferred from `min` and `max` being present, which is the whole
 * point. A slider is right for a value somebody feels for (a percentage, a trim in decibels, one
 * pad every N breaks) and wrong for one they have to hit exactly: 3500 out of 0 to 600000 is a
 * pixel, and a pause in milliseconds is a number an operator types rather than aims at. Declaring
 * it makes that a judgement per setting instead of a rule that is right eight times and wrong six.
 *
 * A `slider` must declare both `min` and `max`, since a range with no ends is not one a track can
 * be drawn for. A field asking for one without them falls back to the ordinary input rather than
 * failing: this is a hint about drawing, and a form that renders nothing is worse than a form that
 * renders a spinner.
 *
 * `tags` is for a `string` that is really a SET, stored as one comma-separated line because that is
 * what the reader behind it splits. It changes nothing about the value: the form splits on the way
 * in and joins on the way out, so `dialogueKinds()` keeps parsing exactly the string it always did.
 * What it buys is that a set of names is added to and removed from one at a time, rather than by
 * editing punctuation in a sentence — a stray comma in a one-line box is a kind the station simply
 * does not have, and nothing says so. The cost is that a value CONTAINING a comma cannot be one
 * tag, which is why this is asked for per field rather than being what a `string` does.
 */
export type ConfigFieldControl = 'slider' | 'tags';

/** One choice in a `select`, a `multiselect`, or a suggestion list. */
export interface ConfigFieldOption {
    value: string;
    label: string;
}

/**
 * Where a field's or a column's choices come from when neither the plugin nor the operator's own
 * server is the one that knows them.
 *
 * A closed HOST vocabulary, and the third of three ways a choice can be offered: `options` is what
 * the PLUGIN decided when its manifest was written, `suggestConfigOptions()` is what the operator's
 * own server currently says, and this is what the STATION says. It exists because a plugin cannot
 * ask — a news plugin has no way to learn which categories this station holds, and the alternative
 * is a free-text cell where `sports` and `sport` are a silent miss nobody sees until bulletins start
 * declining.
 *
 * `intl.timeZones` is the second member and stretches the name slightly: it is the PLATFORM's list
 * rather than the station's, out of `Intl.supportedValuesOf('timeZone')`. It belongs here anyway,
 * because the property is about who can answer rather than about where the answer is kept, and the
 * console is again the only side that can — a zone name has to be one the browser and the server
 * both know, and a server that enumerated its own would be answering for a different machine.
 *
 * `station.newsFeeds` answers the feeds the installed plugins currently offer, by their qualified id
 * and the operator's own name for each. It is the one source whose value is minted by a PLUGIN and
 * whose list only the station can assemble, which is why it is here rather than being something a
 * plugin could answer: the ids are qualified with the plugin that offered them, and no plugin knows
 * what the others are called.
 *
 * The four `plugins.*` members answer the enabled plugins that declare a given capability — speech,
 * llm, mixer, analysis — by id and name, for the settings that pick which plugin a capability with
 * several installed candidates uses. Those settings stay free text (`selectPlugin` in
 * `plugin.selection.ts` accepts an id that is not currently a candidate without falling back), so
 * this is a suggestion list rather than a closed `select` — the console resolves it the same way as
 * the other sources here, against the plugin list rather than a static enum.
 *
 * An enum rather than a boolean for {@link ConfigFieldUnit}'s reason: the next one (voices,
 * personas) is obvious, and a closed set is what the contract mirroring this can express. Whatever
 * it names is resolved by the CONSOLE; nothing here reaches a plugin.
 */
export type ConfigFieldOptionSource =
    'station.newsCategories' | 'station.newsFeeds' | 'intl.timeZones' | 'plugins.speech' | 'plugins.llm' | 'plugins.mixer' | 'plugins.analysis';

/**
 * One column of a `list` field.
 *
 * Deliberately a smaller vocabulary than {@link ConfigFieldType}: no `secret`, because a row is
 * stored as plain JSON and nothing encrypts one cell of it, and no nested `list`, because a table
 * inside a table is a form nobody can fill in. Every cell is stored as a STRING, so a column is
 * about the control the operator gets rather than about the shape of what is kept.
 */
export interface ConfigFieldColumn {
    /**
     * Key this cell is stored under inside the row object.
     *
     * Whatever suits the plugin, dots included, exactly like {@link ConfigField.key}. A row editor
     * addresses a cell by a path and a dot in a path means a step into a nested object, but that is
     * the FORM's problem and it solves it the way it already solves the same problem for a
     * dot-keyed station setting: it names its inputs positionally and puts the real keys back on
     * the way out. Nothing a plugin author has to know about.
     */
    key: string;

    /** Column heading. */
    label: string;

    /** `string` free text, `url` free text meant to be an address, `select` one of `options`. */
    type: 'string' | 'url' | 'select';

    /** Whether a row is only counted once this cell is filled in. */
    required?: boolean;

    /** Ghost text inside the cell. */
    placeholder?: string;

    /** Choices, fixed when the manifest is written. See {@link ConfigField.options}. */
    options?: ConfigFieldOption[];

    /** Choices only the station can enumerate. See {@link ConfigFieldOptionSource}. */
    optionsFrom?: ConfigFieldOptionSource;
}

/**
 * The chosen values of a `multiselect`, out of the string it is stored as.
 *
 * Stored as a JSON array because plugin config is a string map, and read back
 * through here so every plugin agrees on the encoding. Tolerant on purpose: a
 * value hand-edited into something unreadable answers empty rather than failing
 * a load, which for a field like "which models can use tools" is the difference
 * between a degraded station and one that will not start.
 */
export function parseMultiSelect(raw: unknown): string[] {
    if (typeof raw !== 'string' || raw.trim().length === 0) return [];

    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map(value => value.trim());
    } catch {
        return [];
    }
}

/**
 * The rows of a `list` field, out of the string it is stored as.
 *
 * A JSON array of objects in a string, for {@link parseMultiSelect}'s reason and encoded the same
 * way, so a `list` needs nothing of the storage path that a `string` did not already have. Tolerant
 * in the same way and for the same stakes: anything unreadable is no rows rather than a plugin that
 * will not load, and a cell that is not a string is dropped rather than stringified, since a number
 * where a URL was expected is a mistake worth seeing as an empty cell.
 *
 * A row with nothing in it is dropped, because the form leaves one behind whenever an operator adds
 * a row and thinks better of it.
 */
export function parseRows(raw: unknown): Record<string, string>[] {
    if (typeof raw !== 'string' || raw.trim().length === 0) return [];

    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed.flatMap(entry => {
            if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];

            const row: Record<string, string> = {};
            for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
                if (typeof value === 'string' && value.trim().length > 0) row[key] = value.trim();
            }

            return Object.keys(row).length === 0 ? [] : [row];
        });
    } catch {
        return [];
    }
}

/**
 * A declarative description of one row in a plugin's settings form. The host
 * renders these; plugins never ship UI.
 */
export interface ConfigField {
    /** Key this value is stored under, and the key `host.config`/`host.secrets` reads it back by. */
    key: string;

    /** Human label shown next to the input. */
    label: string;

    type: ConfigFieldType;

    /** Whether the form refuses to save without a value. Defaults to false. */
    required?: boolean;

    /** Prefilled value. Never provide a default for a `secret`. */
    default?: string | number | boolean;

    /**
     * What a `number`'s value is measured in. Ignored on every other type.
     *
     * See {@link ConfigFieldUnit}: the stored value stays in this unit and only the control the
     * operator touches changes.
     */
    unit?: ConfigFieldUnit;

    /**
     * The control to draw this field with, where the ordinary one for its type reads badly.
     *
     * `slider` is for a `number` and is ignored without both `min` and `max`; `tags` is for a
     * `string`. See {@link ConfigFieldControl}. Nothing about the stored value changes either way.
     */
    control?: ConfigFieldControl;

    /**
     * How coarsely a `control` moves. Ignored without one, and defaults to 1.
     *
     * The unit is the field's own, so a share between 0 and 1 wants `0.05` and a word count wants
     * `10`. Worth setting on anything whose range is wider than the pixels it is drawn in, since
     * the alternative is a control that can express values nobody wants and cannot be stopped on
     * the ones they do.
     */
    step?: number;

    /**
     * The smallest and largest a `number` may be, inclusive. Ignored on every other type.
     *
     * A range the field is DECLARED with rather than one the reader clamps to, which is the whole
     * point: a resolver that clamps answers a legal number for an illegal one, so the station runs
     * on something the console never showed and the operator never chose. Declared here, the console
     * refuses it in front of them and the station's own settings route refuses it again for anything
     * that did not come through a console.
     *
     * A plugin's config is NOT validated against these — the host stores what it is handed and a
     * plugin's own schema is what judges it — so for a plugin these are a hint to the form. For a
     * station setting they are enforced, in `serializeSetting`.
     */
    min?: number;
    max?: number;

    /** Ghost text inside the input. */
    placeholder?: string;

    /** Longer explanation rendered under the input. */
    help?: string;

    /**
     * Choices, for a `select` or a `multiselect`.
     *
     * Fixed when the manifest is written, so this is for a closed set the plugin
     * decides. For anything the operator's own server decides, implement
     * `suggestConfigOptions()` instead: what it returns for this key replaces
     * these, and it can also turn a `string` into free text with suggestions.
     */
    options?: ConfigFieldOption[];

    /**
     * Choices only the console can enumerate. See {@link ConfigFieldOptionSource}.
     *
     * The field-level twin of {@link ConfigFieldColumn.optionsFrom}, and it resolves the same way
     * and merges at the same point: whatever `suggestConfigOptions()` says for this key wins, and
     * this is what is offered when it says nothing.
     */
    optionsFrom?: ConfigFieldOptionSource;

    /**
     * The columns of a `list`, in the order they are drawn. Ignored on every other type.
     *
     * A `list` with none is a field with nothing to fill in, so declare at least one.
     */
    columns?: ConfigFieldColumn[];

    /**
     * Key of another field in the same form. This field is only shown when
     * that field has a truthy value.
     */
    dependsOn?: string;

    /**
     * Key of the `number` field that is the UPPER end of the range this one opens. Declared on the
     * lower end only, and ignored on every other type.
     *
     * Two settings, still: each keeps its own key, its own row and its own validation, and
     * `serializeSetting` refuses each one by name exactly as it did before. What this changes is
     * that the console draws them as one control with two handles instead of two boxes that happen
     * to sit next to each other.
     *
     * The reason is legibility. Two boxes cannot say that one is the far end of the other, so a
     * range arrives as two settings whose labels have to carry the relationship ("fewest", "most",
     * "the other end") and an operator reads the pair rather than seeing it. One track with two
     * handles says it in the shape of the control.
     *
     * NOT correctness, which is worth stating because it is the plausible reason and it is wrong
     * here: every reader of a paired setting in this station takes the two ends as an UNORDERED
     * pair and sorts them, so a range stored the wrong way round has always been tolerated rather
     * than obeyed. The handles not crossing is a nicety on top, not the point.
     *
     * Worth declaring only where the declared range is narrow enough that the whole track is
     * usable. A pair bounded by a typo guard rather than by intent — one to a hundred and twenty
     * minutes, for a station that runs eight to twelve — puts both handles in the first tenth and
     * makes the exact figure somebody has in mind a pixel. Those stay two boxes.
     *
     * A rendering hint like {@link ConfigField.dependsOn}, and forgiving in the same way: if the
     * named key is not in this form, both ends fall back to their own controls rather than one of
     * them disappearing. A settings page that draws one group of a larger set is the ordinary case
     * for that.
     */
    rangeWith?: string;
}

export const configFieldOptionSchema = z.object({
    value: z.string(),
    label: z.string(),
});

export const configFieldTypeSchema = z.enum(['string', 'text', 'url', 'secret', 'number', 'boolean', 'select', 'multiselect', 'list', 'note']);

export const configFieldUnitSchema = z.enum(['bytes', 'fraction']);

export const configFieldControlSchema = z.enum(['slider', 'tags']);

export const configFieldOptionSourceSchema = z.enum([
    'station.newsCategories',
    'intl.timeZones',
    'plugins.speech',
    'plugins.llm',
    'plugins.mixer',
    'plugins.analysis',
]);

export const configFieldColumnSchema = z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.enum(['string', 'url', 'select']),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
    options: z.array(configFieldOptionSchema).optional(),
    optionsFrom: configFieldOptionSourceSchema.optional(),
});

export const configFieldSchema = z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: configFieldTypeSchema,
    required: z.boolean().optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    unit: configFieldUnitSchema.optional(),
    control: configFieldControlSchema.optional(),
    step: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    placeholder: z.string().optional(),
    help: z.string().optional(),
    options: z.array(configFieldOptionSchema).optional(),
    optionsFrom: configFieldOptionSourceSchema.optional(),
    columns: z.array(configFieldColumnSchema).optional(),
    dependsOn: z.string().optional(),
    rangeWith: z.string().optional(),
});
