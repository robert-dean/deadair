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
 * So a row gets an id (`ROW_ID_KEY`), preserved from save to save, and the cell's ciphertext lives
 * in the same flat secrets map every other secret uses, under `field/row/column`. Nothing about
 * encryption, reporting or the never-leaves-the-server rule changed; only the key did.
 *
 * **The console mints the id**, the moment a row is added, and this file mints one only for a row
 * that arrives without (an API caller, or a row stored before ids existed). It used to be the other
 * way round, and that was issue #242: the console's form is not rebuilt after a save, so an id minted
 * here never reached it, and the NEXT save sent the row with no id — which read as a new row, and
 * deleted the credential of the one it replaced.
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
 *
 * ## A kept secret never follows a changed address
 *
 * An omitted secret is KEPT, which is what lets an operator save one setting without retyping every
 * key. Unqualified, that rule is also an exfiltration: anybody allowed to save the form, or an API
 * key scoped as widely, could point `baseUrl` at a server of their own and have the station send it
 * a credential the console never shows. So a secret that declares `sentTo` is refused when a save
 * keeps it while the address it names moves to another ORIGIN ({@link originOf}). The origin rather
 * than the whole URL, so a path edit on the same server costs nothing; refused rather than cleared,
 * so a typo in an address never destroys a key. {@link movedSecretFields} is the check for a field
 * and {@link splitRowSecrets} makes it for a cell, against the same row as it was stored.
 */

/** The columns of a field that hold credentials. Empty for every field that is not a `list`. */
export function secretColumnsOf(field: ConfigField): ConfigFieldColumn[] {
    if (field.type !== 'list') return [];
    return (field.columns ?? []).filter(column => column.type === 'secret');
}

/** Whether this field needs any of the handling below. */
export const holdsRowSecrets = (field: ConfigField): boolean => secretColumnsOf(field).length > 0;

/**
 * Whether a column applies to one row, per its own `dependsOn`.
 *
 * The host's copy of the console's rule (`appliesToRow` in `config.fields.values.ts`), and it has to
 * agree with it: a cell the form declines to send and one the allowlist declines to read are the
 * same claim made in two places, and a plugin whose address is refused by one and accepted by the
 * other looks broken rather than misconfigured. Read by the allowlist (`addressCells` in
 * `plugin.network.settings.ts`) and by {@link splitRowSecrets}, where an address cell that does not
 * apply is no address at all.
 *
 * Forgiving in exactly the three places the console's is, and here that is the conservative
 * direction rather than the lenient one: an unresolvable condition leaves the address contributing
 * a host, which is what it did before any of this existed. Narrowing an allowlist is a thing to do
 * on a declaration that plainly says so, not on one nothing can make sense of.
 */
export const columnAppliesToRow = (column: ConfigFieldColumn, columns: readonly ConfigFieldColumn[], row: Record<string, unknown>): boolean => {
    if (column.dependsOn === undefined) return true;

    const target = columns.find(candidate => candidate.key === column.dependsOn);
    if (target === undefined) return true;

    const cell = row[target.key];
    const value = typeof cell === 'string' ? cell.trim() : '';
    if (value.length === 0) return true;

    return column.dependsOnValues === undefined ? true : column.dependsOnValues.includes(value);
};

/**
 * Where an address sends what is sent to it, as a string two addresses can be compared by.
 *
 * The URL's origin (scheme, host, port, with the default port and the host's case normalised away)
 * for anything that parses as one. Anything that does not, or that parses to an opaque origin (a
 * bare `smtp.example.com:587` reads as a URL whose scheme is the host), is compared as its own
 * lowercased text instead: two such addresses are the same server only when they say so, which is
 * the conservative direction for a check whose cost of being wrong is a credential. Empty for no
 * address at all.
 */
export function originOf(address: unknown): string {
    if (typeof address !== 'string') return '';

    const trimmed = address.trim();
    if (trimmed.length === 0) return '';

    try {
        const origin = new URL(trimmed).origin;
        if (origin !== 'null') return origin;
    } catch {
        // Not a URL. Compared as text below.
    }

    return trimmed.toLowerCase();
}

/** What a field's address is worth: its own value when it has one, else wherever its default points. */
const addressOf = (value: unknown, field: ConfigField | undefined): string =>
    originOf(typeof value === 'string' && value.trim().length > 0 ? value : field?.default);

/** What the console shows under a secret field this refuses. Text from the API is shown as it comes. */
export const MOVED_SECRET_MESSAGE = 'Enter it again: the address it is sent to changed.';

/**
 * The `secret` FIELDS this save would keep while moving the address each names in `sentTo`, keyed by
 * the secret's own key, each with the sentence to show under it. Empty when there are none.
 *
 * A secret is only kept when the submission leaves it out (present, it is set or cleared, and either
 * is the operator's say rather than the old key's), only matters when something is stored, and is
 * only moved when the submission names its address and that address's origin differs from the stored
 * one. `stored` is the plain values as they stand and `hasSecret` whether a secret is stored under a
 * key, so the plugins' config and the station's settings can both ask.
 */
export function movedSecretFields(
    fields: readonly ConfigField[],
    stored: Record<string, unknown>,
    hasSecret: (key: string) => boolean,
    submitted: Record<string, unknown>,
): Record<string, string> {
    const moved: Record<string, string> = {};

    for (const field of fields) {
        const sentTo = field.sentTo;
        if (field.type !== 'secret' || sentTo === undefined) continue;
        if (Object.hasOwn(submitted, field.key) || !Object.hasOwn(submitted, sentTo) || !hasSecret(field.key)) continue;

        const address = fields.find(candidate => candidate.key === sentTo);
        if (addressOf(stored[sentTo], address) !== addressOf(submitted[sentTo], address)) moved[field.key] = MOVED_SECRET_MESSAGE;
    }

    return moved;
}

/**
 * What a submitted secret FIELD means: a value sets it, and `null`, `''` or nothing at all clears it.
 * A field left out of the submission is kept, which is the caller's business rather than this one's.
 *
 * The same answer for the save and for the form a plugin's schema judges before it. They used to
 * disagree over `''`, which the save cleared and the check read as "keep", so a required secret
 * submitted blank passed validation and was then deleted. A CELL is different, deliberately: there
 * `''` is a cell nobody typed into and keeps what is stored (see {@link intentOf}).
 */
export function secretFieldIntent(value: unknown): { set: string } | 'clear' {
    if (value === undefined || value === null) return 'clear';
    const text = typeof value === 'string' ? value.trim() : String(value).trim();
    return text.length === 0 ? 'clear' : { set: text };
}

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

    /** The whole secrets map the field's cells live in (a plugin's, or the station's settings), updated for this field. */
    secrets: Record<string, string>;

    /**
     * Why this save cannot be stored, as one sentence for the list's own field, or nothing when it
     * can: a row keeps a stored credential while the address it is sent to moved. The caller refuses
     * the save; `value` and `secrets` are still computed so a caller never has to special-case it.
     */
    refused?: string;
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
 *
 * `previous` is the list as it is stored now, which is what a kept credential's address is compared
 * with: a cell declaring `sentTo` that is KEPT on a row whose address moved to another origin is
 * reported in {@link SplitRows.refused}. Compared by row id rather than position, because the console
 * lets the operator reorder rows, and with the stored row rather than another submitted one, so a
 * second row sent under the same id is compared with the original too. An address cell that does not
 * apply to its row counts as no address, since the plugin never reads it: otherwise an address left
 * on a row whose kind was later changed could be switched on underneath a kept key.
 */
export function splitRowSecrets(
    field: ConfigField,
    submitted: unknown,
    existing: Record<string, string>,
    encrypt: (plaintext: string) => string,
    previous?: unknown,
): SplitRows {
    const columns = secretColumnsOf(field);
    const allColumns = field.columns ?? [];
    const previousRows = new Map(parseRows(previous).map(row => [idOf(row), row] as const));
    const secrets = { ...existing };
    const kept = new Set<string>();
    const rows: Record<string, string>[] = [];
    const moved = new Set<ConfigFieldColumn>();

    /** A row's address for one secret column, as {@link originOf} has it, or `''` where it has none. */
    const addressOn = (row: Record<string, unknown> | undefined, column: ConfigFieldColumn): string => {
        const address = allColumns.find(candidate => candidate.key === column.sentTo);
        if (row === undefined || address === undefined || !columnAppliesToRow(address, allColumns, row)) return '';
        return originOf(row[address.key]);
    };

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
            else if (column.sentTo !== undefined && existing[key] !== undefined) {
                if (addressOn(previousRows.get(rowId), column) !== addressOn(submittedRow, column)) moved.add(column);
            }

            kept.add(key);
        }

        rows.push(stored);
    }

    // Everything this field used to hold that no surviving row claims.
    const prefix = `${field.key}/`;
    for (const key of Object.keys(secrets)) {
        if (key.startsWith(prefix) && isRowSecretKey(key) && !kept.has(key)) delete secrets[key];
    }

    const refused =
        moved.size === 0
            ? undefined
            : [...moved]
                  .map(
                      column =>
                          `Enter the ${column.label} again on each row whose address changed: a stored credential is never sent to a new address.`,
                  )
                  .join(' ');

    return { value: JSON.stringify(rows), secrets, refused };
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
            const intent = secretFieldIntent(submitted[field.key]);
            if (intent === 'clear') delete effective[field.key];
            else effective[field.key] = intent.set;
            continue;
        }

        if (holdsRowSecrets(field)) {
            effective[field.key] = rowsAsTheyWillBe(field, stored[field.key], secrets, isSubmitted ? submitted[field.key] : undefined);
            continue;
        }

        // `null` is the console clearing a field that had a value, and the key goes rather than
        // reaching the schema as a value: plugin code reads "not set" as `undefined`, so an
        // `.optional()` number refused the blanked box with zod's bare "Invalid input".
        if (isSubmitted) {
            if (submitted[field.key] === null) delete effective[field.key];
            else effective[field.key] = submitted[field.key];
        }
    }

    return effective;
}

/**
 * One list field's rows, with their credentials put back, as the JSON string a schema reads.
 *
 * The submission decides which rows there are; the stored secrets decide what a cell holds where
 * the submission did not say. A row the console has just added has an id nothing is stored against
 * yet (or none at all), so only what was typed counts — which is exactly right, and is why a required
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
