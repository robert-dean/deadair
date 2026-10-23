/**
 * What a config form's values ARE, with no React in it: how a stored setting becomes a form value
 * and back, how a rows field's rows are read, minted, kept or dropped, and which fields are shown.
 *
 * Split out of `config.fields.form.tsx` unchanged, so the rules about the wire shape can be read
 * apart from the controls that draw them.
 */
import type { ConfigFieldColumn, ConfigFieldDescriptor, ConfigFieldPreset } from '@deadair/sdk';

/**
 * The cell a row's own identity lives under, and how a credential inside a row is addressed.
 *
 * Both are spelled out here rather than imported, for the reason `declared.options.ts` spells the
 * plugin capabilities out: this console has no dependency on `@deadair/plugin-sdk`, and these are
 * part of the wire contract rather than something that moves without a contract change of its own.
 * The API reports each cell's configured-ness under the joined key; the form's job is to send the
 * id and never to show what it addresses.
 */
export const ROW_ID_KEY = '$id';

export const rowSecretKey = (fieldKey: string, rowId: string, columnKey: string): string => `${fieldKey}/${rowId}/${columnKey}`;

/**
 * A new row's id, minted HERE rather than left to the API, which keeps whatever id a row arrives with
 * and mints one only for a row that has none.
 *
 * It used to be left to the API, and that was issue #242. This form is not rebuilt from the server
 * after a save, so an id minted there never reached it: the next save sent the row with no id and,
 * the key cell having been wiped after the first save, no key. The server read that as a brand-new
 * row, deleted the stored key along with the row it thought was gone, and refused the form for a
 * missing key the operator had typed a minute before. An id that exists before the first save is
 * the same id on every save after it.
 *
 * The API's own shape: six random bytes as base64url, which can never hold the `/` that
 * {@link rowSecretKey} joins on. `getRandomValues` rather than `randomUUID` because the latter needs
 * a secure context, and a station on a home network is opened over plain http (see `pkce.ts`).
 */
function mintRowId(): string {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * Whether a list's rows carry ids at all. Only a list holding a credential does, which is the API's
 * rule too (`holdsRowSecrets`): in a list of feeds an id addresses nothing, and the API stores such
 * a list exactly as sent, so one minted here would be written into every row for nothing to read.
 */
const holdsRowSecrets = (columns: readonly ConfigFieldColumn[]): boolean => columns.some(column => column.type === 'secret');

/** One row of a `list` field. Every cell is a string; the column decides the control, not the value. */
export type FieldRow = Record<string, string>;

export type FieldValue = string | number | boolean | FieldRow[];

export type FormValues = Record<string, FieldValue>;

/**
 * The name a CELL goes under inside the form, which is not its column key.
 *
 * {@link nameOf}'s rule, one level down and for exactly the same reason: a cell is addressed by a
 * path (`f3.0.c2`), so a column key carrying a dot would read as a path into a nested object and the
 * cell would draw empty and submit nothing, in silence. Positional rather than an escaped form of
 * the key, because every escaping scheme can be collided with by a key that already contains the
 * escape character — translating `.` to `-` would quietly merge a plugin's `a.b` and `a-b` into one
 * cell — and this cannot.
 *
 * The consequence worth stating: a plugin picks whatever column keys suit it, including dotted ones,
 * and the STORED row still holds those keys. Only this form's internal names are positional, and
 * {@link rowsForSubmission} puts the real ones back.
 */
export const cellNameOf = (column: number): string => `c${column}`;

/**
 * A `list`'s rows, out of the JSON array it is stored as, under the form's own cell names.
 *
 * Duplicated from the plugin SDK's `parseRows` for {@link parseChosen}'s reason, and tolerant in the
 * same way: a hand-edited value should cost the field rather than the page. Unlike the SDK's reader
 * this keeps a row whose cells are all empty, because the form has to be able to hold the blank row
 * an operator has just added and not yet typed into. `buildSubmission` is what drops those.
 *
 * A stored cell whose column the manifest no longer declares is dropped rather than carried through
 * invisibly, which is the treatment `PluginConfigService.saveConfig` already gives a stored key with
 * no descriptor behind it.
 *
 * A row of a credential-holding list stored before rows had ids is given one here, for
 * {@link mintRowId}'s reason: left without, the API would mint a different one on every save.
 */
function parseStoredRows(value: unknown, columns: readonly ConfigFieldColumn[]): FieldRow[] {
    if (typeof value !== 'string' || value.trim().length === 0) return [];

    try {
        const parsed: unknown = JSON.parse(value);
        if (!Array.isArray(parsed)) return [];

        return parsed.flatMap(entry => {
            if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];

            const stored = entry as Record<string, unknown>;
            const row: FieldRow = {};

            // Carried through untouched and never drawn. It is what a stored credential hangs off,
            // so a row that loses it on the way through this form is a row whose key is orphaned.
            const rowId = stored[ROW_ID_KEY];
            if (typeof rowId === 'string' && rowId.length > 0) row[ROW_ID_KEY] = rowId;
            else if (holdsRowSecrets(columns)) row[ROW_ID_KEY] = mintRowId();

            columns.forEach((column, at) => {
                const cell = stored[column.key];
                row[cellNameOf(at)] = typeof cell === 'string' ? cell : '';
            });
            return [row];
        });
    } catch {
        return [];
    }
}

/** A field's value as rows, for the one type that holds an array rather than a scalar. */
export const rowsOf = (value: FieldValue | undefined): FieldRow[] => (Array.isArray(value) ? value : []);

/**
 * A row nobody filled in. The form leaves one behind whenever somebody adds a row and thinks better
 * of it.
 *
 * The id does not count as filling one in: it is the form's bookkeeping rather than the operator's
 * answer, and counting it would keep every emptied row alive forever.
 */
const isBlankRow = (row: FieldRow): boolean => Object.entries(row).every(([name, cell]) => name === ROW_ID_KEY || cell.trim().length === 0);

/**
 * The rows as they are sent: the columns' own keys back, blank rows dropped, every cell trimmed, and
 * each row's id carried through so the server can keep a credential attached to it.
 *
 * A cell nobody filled in is left OUT of its row rather than sent as an empty string, which is the
 * same rule the rest of the submission follows and the one the plugin SDK reads rows under: absent
 * means not set.
 *
 * A `secret` cell follows the three-way rule a secret FIELD does, for the same reasons. Typed sets
 * it. Absent keeps whatever is stored, which is what lets an operator rename a row without retyping
 * the key beside it. `null` clears it — present and explicitly empty, rather than `''`, which is
 * what a half-typed field looks like. A row is only ever emptied of its credential deliberately.
 *
 * A cell that does not apply to its row ({@link appliesToRow}) is left out on the same footing as
 * one nobody filled in, which is the point of the declaration rather than a tidiness: an address
 * typed before a row's kind was changed would otherwise be stored and read straight into the
 * plugin's network allowlist. A `secret` that stops applying is passed over entirely rather than
 * cleared, because absent means "keep it" and destroying a credential is not what a rule about
 * which cells apply should be taken to mean.
 *
 * `columns` stays the FULL declared list here and the visibility question is asked per cell. It has
 * to: a cell is named by its column's POSITION (see {@link cellNameOf}), so filtering the array
 * would shift every index after the first hidden column and write cells under their neighbours'
 * keys, in silence.
 */
const rowsForSubmission = (
    rows: readonly FieldRow[],
    columns: readonly ConfigFieldColumn[],
    fieldKey: string,
    cleared: ReadonlySet<string>,
): Record<string, unknown>[] =>
    rows
        .filter(row => !isBlankRow(row))
        .map(row => {
            const rowId = row[ROW_ID_KEY];
            const submitted: Record<string, unknown> = rowId === undefined ? {} : { [ROW_ID_KEY]: rowId };

            for (const [at, column] of columns.entries()) {
                if (!appliesToRow(column, columns, row)) continue;

                const cell = (row[cellNameOf(at)] ?? '').trim();

                if (column.type === 'secret') {
                    if (rowId !== undefined && cleared.has(rowSecretKey(fieldKey, rowId, column.key))) submitted[column.key] = null;
                    else if (cell.length > 0) submitted[column.key] = cell;
                    continue;
                }

                if (cell.length > 0) submitted[column.key] = cell;
            }

            return submitted;
        });

/**
 * An empty row of the declared columns, so a new row draws every cell rather than growing them as it
 * is typed into. One that can hold a credential is born with its id; see {@link mintRowId}.
 */
export const emptyRow = (columns: readonly ConfigFieldColumn[]): FieldRow => ({
    ...(holdsRowSecrets(columns) ? { [ROW_ID_KEY]: mintRowId() } : {}),
    ...Object.fromEntries(columns.map((_, at) => [cellNameOf(at), ''])),
});

/**
 * A new row with a preset's cells filled in and every other cell empty.
 *
 * Cells are matched to columns by KEY and written under the column's positional name, as every
 * other cell is. A cell naming no column is dropped, and so is a `secret` column's, which a preset
 * is documented never to fill: a value arriving there would be a credential out of a manifest.
 */
export const presetRow = (columns: readonly ConfigFieldColumn[], preset: ConfigFieldPreset): FieldRow => {
    const row = emptyRow(columns);
    for (const [at, column] of columns.entries()) {
        const value = preset.cells[column.key];
        if (value !== undefined && column.type !== 'secret') row[cellNameOf(at)] = value;
    }
    return row;
};

/** The columns a `list` declared. A field of another type has none, and a `list` with none draws nothing to fill in. */
export const columnsOf = (field: ConfigFieldDescriptor): readonly ConfigFieldColumn[] => field.columns ?? [];

/**
 * A `tags` field's entries, out of the one comma-separated line it is stored as.
 *
 * NOT the JSON a `multiselect` uses, and deliberately: this control is drawn over a setting that
 * was already a comma-separated string and is read as one on the server, so changing the encoding
 * would be changing the setting rather than the control. Trimmed and emptied exactly as
 * `dialogueKinds()` trims and empties on the other side, so what the operator sees as a chip is
 * what the station sees as a kind.
 */
export function tagsOf(value: FieldValue | undefined): string[] {
    if (typeof value !== 'string') return [];
    return value
        .split(',')
        .map(entry => entry.trim())
        .filter(entry => entry.length > 0);
}

/**
 * A `multiselect`'s chosen values, out of the JSON array it is stored and submitted as.
 *
 * Duplicated from the plugin SDK's `parseMultiSelect` rather than imported, because the console
 * has no business depending on the plugin SDK: it never loads a plugin, and the encoding is four
 * lines. Kept deliberately tolerant for the same reason the original is — a hand-edited value
 * should cost the field, not the page.
 */
export function parseChosen(value: FieldValue | undefined): string[] {
    if (typeof value !== 'string' || value.trim().length === 0) return [];
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
    } catch {
        return [];
    }
}

/** `note` fields are static help text: they are never inputs and never submitted. */
export const isInput = (field: ConfigFieldDescriptor): boolean => field.type !== 'note';

/**
 * The name a field goes under INSIDE the form, which is not its key.
 *
 * Mantine reads a dot in a field name as a path into a nested object, so a form field literally
 * named `stream.title` writes and reads `values.stream` `.title` — and every station setting is
 * dot-keyed. The symptom is quiet and total: every input renders empty and every save submits
 * nothing that was typed.
 *
 * Positional rather than an escaped form of the key, because any escaping scheme can be collided
 * with by a key that already contains the escape character, and this cannot. The key never leaves
 * this file's reach, so nothing outside this file sees these names.
 */
export const nameOf = (index: number): string => `f${index}`;

/** Whether a value counts as answered, for `required` and for `dependsOn`. */
export const isAnswered = (value: FieldValue | undefined): boolean => {
    // A list of blank rows is a list nobody has filled in, which is what `required` is asking about.
    if (Array.isArray(value)) return value.some(row => !isBlankRow(row));
    return value !== undefined && value !== '' && value !== false;
};

/**
 * The form as the server will see it.
 *
 * Secrets are never prefilled — both APIs report only whether one is stored, never its value — so a
 * secret input always starts empty regardless of what is held.
 */
export function initialValues(fields: readonly ConfigFieldDescriptor[], stored: Record<string, unknown>): FormValues {
    const values: FormValues = {};
    fields.forEach((field, index) => {
        if (!isInput(field)) return;
        const name = nameOf(index);
        if (field.type === 'secret') {
            values[name] = '';
            return;
        }
        const current = stored[field.key] ?? field.default;
        if (field.type === 'list') {
            // A real array in the form's own state, which is what lets the row editor use Mantine's
            // list handlers and address a cell by path. It is turned back into the JSON string it is
            // stored as on the way out, in `buildSubmission`.
            values[name] = parseStoredRows(current, columnsOf(field));
        } else if (field.type === 'boolean') {
            values[name] = current === true;
        } else if (field.type === 'number') {
            values[name] = typeof current === 'number' ? current : '';
        } else {
            values[name] = current === undefined || current === null ? '' : String(current);
        }
    });
    return values;
}

/**
 * A field whose `dependsOn` target is still unanswered is not part of this form yet.
 *
 * `dependsOn` names another field's KEY, so it is resolved back to a form name here. A target that
 * is not in this form at all — a settings section rendering one group of a larger set — counts as
 * answered: hiding a field because its condition is on a different page would be worse than
 * showing it.
 */
export function isVisible(field: ConfigFieldDescriptor, fields: readonly ConfigFieldDescriptor[], values: FormValues): boolean {
    if (field.dependsOn === undefined) return true;
    const target = fields.findIndex(candidate => candidate.key === field.dependsOn);
    if (target === -1) return true;
    return isAnswered(values[nameOf(target)]);
}

/**
 * {@link isVisible}'s twin one level down: whether a COLUMN applies to this particular row.
 *
 * The case it exists for is a table whose columns are not all about the same row — a provider list
 * where one kind is reached at an address the operator runs and another at its vendor's. Drawing
 * every column on every row puts a cell in front of somebody that their row has no use for, with
 * nothing to tell it from one they simply have not filled in.
 *
 * It says more than the field-level rule does, which is why the answer is also consulted by
 * {@link rowsForSubmission} rather than only by the drawing: a cell that does not apply is not sent
 * at all. A stale address left behind by a change of kind would otherwise still be stored, and the
 * host reads the `url` column of every row into the plugin's network allowlist.
 *
 * Forgiving three times over, and each one for {@link isVisible}'s reason — a rule about drawing
 * should never be the thing that hides the control somebody needs:
 *
 * - a target this list does not declare shows the cell;
 * - a target cell that is EMPTY shows the cell, which is the load-bearing one. A column has no
 *   `default`, so every cell of a row just added is empty, and the alternative hides a cell on the
 *   one row most in need of filling in;
 * - values with no target are ignored.
 */
export function appliesToRow(column: ConfigFieldColumn, columns: readonly ConfigFieldColumn[], row: FieldRow): boolean {
    if (column.dependsOn === undefined) return true;

    const target = columns.findIndex(candidate => candidate.key === column.dependsOn);
    if (target === -1) return true;

    const value = (row[cellNameOf(target)] ?? '').trim();
    if (value.length === 0) return true;

    return column.dependsOnValues === undefined ? true : column.dependsOnValues.includes(value);
}

/**
 * The submission, built to the partial-update contract both servers implement
 * (`PluginConfigService.saveConfig`, `SettingsService.write`): a key that is present is written, a
 * key that is absent keeps whatever is stored.
 *
 * That is what makes the secret rules work. An untouched secret is left out, so an operator can
 * save the rest of the form without retyping it, and a secret the operator cleared is sent as
 * `null` — present, and explicitly empty. `null` rather than `''` because clearing is a deliberate
 * act: `undefined` would vanish from the JSON and read as "keep", and `''` is what a half-typed
 * field looks like. A blanked number that had a stored value is cleared the same way; one that
 * never had a value is simply omitted, since there is nothing to remove.
 */
export function buildSubmission(
    fields: readonly ConfigFieldDescriptor[],
    stored: Record<string, unknown>,
    values: FormValues,
    cleared: ReadonlySet<string>,
): Record<string, unknown> {
    const submission: Record<string, unknown> = {};
    fields.forEach((field, index) => {
        if (!isInput(field) || !isVisible(field, fields, values)) return;
        const value = values[nameOf(index)];

        if (field.type === 'secret') {
            if (cleared.has(field.key)) {
                submission[field.key] = null;
            } else if (typeof value === 'string' && value.length > 0) {
                submission[field.key] = value;
            }
            return;
        }

        if (field.type === 'list') {
            submission[field.key] = JSON.stringify(rowsForSubmission(Array.isArray(value) ? value : [], columnsOf(field), field.key, cleared));
            return;
        }

        if (field.type === 'number') {
            if (value === '') {
                if (stored[field.key] !== undefined) submission[field.key] = null;
            } else {
                submission[field.key] = Number(value);
            }
            return;
        }

        submission[field.key] = value;
    });
    return submission;
}
