import type { AuthoredKind } from './break.kind.js';
import type {
    BreakKindFile,
    BreakKindFileKind,
    BreakKindImportEntry,
    BreakKindImportNotice,
    BreakKindImportPlan,
} from './types/break.kinds.types.js';

/**
 * Kinds of break as a file, to move between stations. Ideas #24 phase 5, on #6's rules for the persona
 * file: the document is a contract type, a preview goes before anything is written, and what the file
 * says about where it came from is provenance and nothing more.
 *
 * What a file leaves out is the point of it. No id, which belongs to the table it came from; no place
 * in a list, which is the receiving operator's order; and no switch, because **every kind a file writes
 * arrives switched off**, new or rewritten. #24 says that is what makes a shared kind safe at all: a
 * brief from somewhere else is read back here before this station says it.
 */
export const BREAK_KIND_FILE_FORMAT = 'deadair.break-kinds/1';

/** One stored kind as a file carries it. */
export function kindForFile(kind: AuthoredKind): BreakKindFileKind {
    return {
        key: kind.key,
        name: kind.name,
        brief: kind.brief,
        rules: [...kind.rules],
        showsPrevious: kind.showsPrevious,
        showsPlayed: kind.showsPlayed,
        showsFacts: kind.showsFacts,
        showsNotebook: kind.showsNotebook,
    };
}

/** What this station holds and may not be given, for {@link planImport}. */
export interface ImportGround {
    /** The kinds an operator here has written, by key. */
    held: readonly AuthoredKind[];
    /** Keys the station uses for breaks of its own. See `stationMadeKinds`. */
    reserved: ReadonlySet<string>;
    /** Keys of held kinds the operator asked the file to rewrite. */
    replace: ReadonlySet<string>;
}

/** One kind in the plan, with what it would be written from. `undefined` for anything not written. */
export interface PlannedKind {
    entry: BreakKindImportEntry;
    kind: BreakKindFileKind;
    /** The kind it rewrites, for an update. */
    held?: AuthoredKind;
}

/**
 * What importing a file would do here. The preview answers with it and the import writes from it, so
 * what an operator was shown is what happens.
 *
 * Four outcomes. A key nothing here holds is created. A key held here is skipped unless it is named in
 * `replace`, because a key match is not consent: two operators can both have written a `poem`. A key
 * the station uses for a break of its own is refused, since the registry would never ask a row for it
 * and a kind that can never air is not something to import silently. And a key twice in one file is
 * taken once, the first time, which is said rather than guessed at.
 */
export function planImport(file: BreakKindFile, ground: ImportGround): { plan: BreakKindImportPlan; kinds: PlannedKind[] } {
    const notices: BreakKindImportNotice[] = [];
    if (file.format !== BREAK_KIND_FILE_FORMAT) {
        notices.push({
            kind: 'format',
            message: `This file says it is "${file.format}", and this station writes "${BREAK_KIND_FILE_FORMAT}". It was read as that, field by field.`,
        });
    }

    const byKey = new Map(ground.held.map(kind => [kind.key, kind]));
    const seen = new Set<string>();
    const kinds: PlannedKind[] = [];

    for (const kind of file.kinds) {
        if (seen.has(kind.key)) {
            notices.push({ kind: 'duplicate', message: `"${kind.key}" is in this file more than once. Only the first was read.` });
            continue;
        }
        seen.add(kind.key);

        if (ground.reserved.has(kind.key)) {
            kinds.push({
                kind,
                entry: {
                    key: kind.key,
                    name: kind.name,
                    outcome: 'refuse',
                    notices: [
                        {
                            kind: 'refused',
                            message: `"${kind.key}" is a kind of break this station makes itself, so it cannot be imported under that key.`,
                        },
                    ],
                },
            });
            continue;
        }

        const held = byKey.get(kind.key);
        if (held === undefined) {
            kinds.push({ kind, entry: { key: kind.key, name: kind.name, outcome: 'create', notices: [] } });
            continue;
        }

        if (!ground.replace.has(kind.key)) {
            kinds.push({ kind, held, entry: { key: kind.key, name: kind.name, outcome: 'skip', notices: [] } });
            continue;
        }

        kinds.push({
            kind,
            held,
            entry: {
                key: kind.key,
                name: kind.name,
                outcome: 'update',
                notices: held.enabled
                    ? [
                          {
                              kind: 'switched-off',
                              message: `"${held.name}" is switched on here. Rewriting it from this file switches it off until you have read it back.`,
                          },
                      ]
                    : [],
            },
        });
    }

    return {
        plan: {
            format: file.format,
            ...(file.station === undefined ? {} : { station: file.station }),
            takenAt: file.takenAt,
            notices,
            kinds: kinds.map(planned => planned.entry),
        },
        kinds,
    };
}
