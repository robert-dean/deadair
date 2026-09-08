import { randomBytes } from 'node:crypto';
import { isRowSecretKey, parseRows, ROW_ID_KEY, rowSecretKey, type ConfigField, type ConfigFieldColumn } from '@deadair/plugin-sdk';

/**
 * A credential that belongs to one ROW of a `list` field.
 *
 * ## What this exists to solve
 *
 * A `secret` field is easy: one key, one ciphertext, one boolean reported back. A secret CELL is
 * not, because the thing it belongs to had no name. A list is stored as one JSON string, the
 * console rewrites the whole array on every save, and the operator can reorder it — so "the key in
 * the third row" is not an address, it is a coincidence that survives until somebody drags a row.
 *
 * So a row gets an id (`ROW_ID_KEY`), minted here the first time it is saved and preserved
 * afterwards, and the cell's ciphertext lives in the same flat secrets map every other secret uses,
 * under `field/row/column`. Nothing about encryption, reporting or the never-leaves-the-server rule
 * changed; only the key did.
 *
 * **Only a list that holds a credential is given ids**, rather than every list uniformly. There is
 * nothing for an id to do in a list of feeds or a voice map, and minting them anyway would rewrite
 * every one of those rows on the next save to carry a key nothing reads. A list that later gains a
 * secret column gets its ids on the first save after that, which is exactly when they start
 * meaning something.
 *
 * ## The rule the whole file keeps
 *
 * **A secret cell is never in the row.** Not in what is stored, not in what is read back, not in
 * what a plugin sees from `parseRows`. It is merged back in exactly once, in {@link formAsItWillBe},
 * and only so a plugin's own zod schema can judge a form that has one — which happens in memory, on
 * the way to a validation, and is never written anywhere.
 */

/** The columns of a field that hold credentials. Empty for every field that is not a `list`. */
export function secretColumnsOf(field: ConfigField): ConfigFieldColumn[] {
    if (field.type !== 'list') return [];
    return (field.columns ?? []).filter(column => column.type === 'secret');
}

/** Whether this field needs any of the handling below. */
export const holdsRowSecrets = (field: ConfigField): boolean => secretColumnsOf(field).length > 0;

/**
 * A new row's name.
 *
 * Short rather than a `randomUUID` like the rest of this codebase mints, and the reason is where it
 * lives: inside a row, in a JSON blob an operator reads in `psql` and a plugin author reads in a
 * log. Thirty-six characters of dashes in front of three real cells makes the row about the id.
 * `base64url` so it can never contain the `/` that {@link rowSecretKey} joins on, and six bytes
 * because the population is the rows of one form.
 */
export const mintRowId = (): string => randomBytes(6).toString('base64url');

/** What a submitted cell means, which is the same three-way contract a `secret` FIELD has. */
type CellIntent = { set: string } | 'clear' | 'keep';

/**
 * A submitted secret cell, as one of the three things it can be.
 *
 * A string sets it, `null` clears it, absent keeps whatever is stored. The middle one is why the
 * console sends `null` rather than `''`: an empty string is what a half-typed field looks like, and
 * clearing a credential is deliberate enough to deserve its own value.
 */
function intentOf(cell: unknown): CellIntent {
    if (cell === null) return 'clear';
    if (typeof cell !== 'string') return 'keep';

    const trimmed = cell.trim();
    return trimmed.length === 0 ? 'keep' : { set: trimmed };
}

/** One row as it arrives from the console: ordinary cells as strings, a secret cell possibly `null`. */
type SubmittedRow = Record<string, unknown>;

/** Whatever the console sent for a `list`, as rows. Tolerant for `parseRows`' reasons. */
function submittedRows(value: unknown): SubmittedRow[] {
    if (typeof value !== 'string' || value.trim().length === 0) return [];

    try {
        const parsed: unknown = JSON.parse(value);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((entry): entry is SubmittedRow => typeof entry === 'object' && entry !== null && !Array.isArray(entry));
    } catch {
        return [];
    }
}

/** A row's id, or nothing at all for one the console has just added. */
const idOf = (row: Record<string, unknown>): string | undefined => {
    const id = row[ROW_ID_KEY];
    return typeof id === 'string' && id.length > 0 ? id : undefined;
};

export interface SplitRows {
    /** The rows as they will be STORED: ids ensured, every secret cell removed. */
    value: string;

    /** The plugin's whole secrets map, updated for this field. */
    secrets: Record<string, string>;
}

/**
 * Split a submitted `list` into the rows that get stored and the ciphertexts that do not.
 *
 * Every surviving row is given an id if it lacks one. Every secret cell is encrypted, cleared or
 * left alone per {@link intentOf}, and then taken OUT of the row. Anything still stored under this
 * field's prefix that no surviving row claims is deleted, which is what makes removing a row remove
 * its credential rather than orphan it in the database forever.
 *
 * `encrypt` is passed in rather than imported so this file can be tested without a key.
 */
export function splitRowSecrets(
    field: ConfigField,
    submitted: unknown,
    existing: Record<string, string>,
    encrypt: (plaintext: string) => string,
): SplitRows {
    const columns = secretColumnsOf(field);
    const secrets = { ...existing };
    const kept = new Set<string>();
    const rows: Record<string, string>[] = [];

    for (const submittedRow of submittedRows(submitted)) {
        const rowId = idOf(submittedRow) ?? mintRowId();

        const stored: Record<string, string> = { [ROW_ID_KEY]: rowId };
        for (const [key, cell] of Object.entries(submittedRow)) {
            if (key === ROW_ID_KEY) continue;
            if (columns.some(column => column.key === key)) continue;
            if (typeof cell === 'string' && cell.trim().length > 0) stored[key] = cell.trim();
        }

        // A row with nothing but an id is one the console left behind: an operator adding a row and
        // thinking better of it. Dropped, along with anything it was holding.
        const hasCells = Object.keys(stored).length > 1;
        const hasSecrets = columns.some(column => intentOf(submittedRow[column.key]) !== 'keep');
        if (!hasCells && !hasSecrets) continue;

        for (const column of columns) {
            const key = rowSecretKey(field.key, rowId, column.key);
            const intent = intentOf(submittedRow[column.key]);

            if (intent === 'clear') delete secrets[key];
            else if (intent !== 'keep') secrets[key] = encrypt(intent.set);

            kept.add(key);
        }

        rows.push(stored);
    }

    // Everything this field used to hold that no surviving row claims.
    const prefix = `${field.key}/`;
    for (const key of Object.keys(secrets)) {
        if (key.startsWith(prefix) && isRowSecretKey(key) && !kept.has(key)) delete secrets[key];
    }

    return { value: JSON.stringify(rows), secrets };
}

/**
 * Which secret cells currently hold something, for the read model. Keys, never values.
 *
 * Every three-part key in the map, rather than only the ones a declared column claims. A field or
 * column an operator has since removed from a manifest leaves entries nothing looks up, and
 * reporting them costs a boolean the console ignores — where filtering them out would mean a cell
 * whose column was renamed reads as unconfigured while its ciphertext is still there.
 */
export function configuredCells(secrets: Record<string, string>): Record<string, boolean> {
    const configured: Record<string, boolean> = {};

    for (const [key, ciphertext] of Object.entries(secrets)) {
        if (isRowSecretKey(key)) configured[key] = ciphertext.length > 0;
    }

    return configured;
}

/**
 * The settings form as a plugin's own schema should judge it.
 *
 * Both callers used to build this by hand as `{ ...plain, ...secrets }`, which was right while every
 * secret was a top-level field and is wrong now: spreading the map would put `providers/ab12/apiKey`
 * into the form as a key no plugin has ever declared, and would leave the row that cell belongs to
 * looking unconfigured to the very refinement meant to check it.
 *
 * So a secret FIELD goes to its own key, and a secret CELL goes back into its row. `submitted` is
 * the form being saved, overlaid on top; absent, this is the stored config as it stands, which is
 * what the load-time check wants.
 *
 * Nothing this returns is ever stored. It exists for the length of one `safeParse`.
 */
export function formAsItWillBe(
    fields: readonly ConfigField[],
    stored: Record<string, unknown>,
    secrets: Record<string, string>,
    submitted?: Record<string, unknown>,
): Record<string, unknown> {
    const effective: Record<string, unknown> = { ...stored };

    // Top-level secrets only. A row's cells are merged into their rows below.
    for (const field of fields.filter(candidate => candidate.type === 'secret')) {
        const value = secrets[field.key];
        if (value !== undefined) effective[field.key] = value;
    }

    for (const field of fields) {
        if (field.type === 'note') continue;

        const isSubmitted = submitted !== undefined && Object.hasOwn(submitted, field.key);

        if (field.type === 'secret') {
            if (!isSubmitted) continue;
            const intent = intentOf(submitted[field.key]);
            if (intent === 'clear') delete effective[field.key];
            else if (intent !== 'keep') effective[field.key] = intent.set;
            continue;
        }

        if (holdsRowSecrets(field)) {
            effective[field.key] = rowsAsTheyWillBe(field, stored[field.key], secrets, isSubmitted ? submitted[field.key] : undefined);
            continue;
        }

        if (isSubmitted) effective[field.key] = submitted[field.key];
    }

    return effective;
}

/**
 * One list field's rows, with their credentials put back, as the JSON string a schema reads.
 *
 * The submission decides which rows there are; the stored secrets decide what a cell holds where
 * the submission did not say. A row the console has just added has no id, so nothing can be stored
 * against it and only what was typed counts — which is exactly right, and is why a required
 * credential on a new row is refused while the same field on an existing row passes untouched.
 */
function rowsAsTheyWillBe(field: ConfigField, storedValue: unknown, secrets: Record<string, string>, submittedValue: unknown): string {
    const columns = secretColumnsOf(field);
    const rows = submittedValue === undefined ? parseRows(storedValue).map(row => ({ ...row }) as SubmittedRow) : submittedRows(submittedValue);

    const effective = rows.map(row => {
        const filled: Record<string, unknown> = {};
        for (const [key, cell] of Object.entries(row)) {
            if (typeof cell === 'string') filled[key] = cell;
        }

        const rowId = idOf(row);
        for (const column of columns) {
            const intent = intentOf(row[column.key]);

            if (intent === 'clear') {
                delete filled[column.key];
                continue;
            }

            if (intent !== 'keep') {
                filled[column.key] = intent.set;
                continue;
            }

            const stored = rowId === undefined ? undefined : secrets[rowSecretKey(field.key, rowId, column.key)];
            if (stored !== undefined) filled[column.key] = stored;
            else delete filled[column.key];
        }

        return filled;
    });

    return JSON.stringify(effective);
}
