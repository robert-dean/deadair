import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { isPersonaBrevity } from './persona.sheet.js';
import type { Persona, PersonaDraft } from './persona.js';

/**
 * The personas an operator has written, and which of them is on air.
 *
 * ## One active persona, enforced by the database
 *
 * `personas_one_active_idx` is a partial unique index rather than a convention, because two active
 * personas is a state nothing downstream could resolve and every reader would resolve differently —
 * the writer would take one, the voice would take another, and the console would show a third.
 * {@link setActive} therefore clears and sets inside one statement's worth of work, in a
 * transaction, so there is no instant with two and no instant with none.
 *
 * ## The sheet's lists are jsonb, and are read back defensively
 *
 * Postgres will hand back whatever was put in, and what was put in came from a console form. A
 * column holding a string where an array belongs is a persona that would otherwise crash a break
 * writer at the moment the station wanted a sentence, so {@link stringsIn} answers `undefined` for
 * anything that is not an array of strings and the sheet renderer treats that as an unset facet.
 * The station losing one field of one persona is a worse-sounding break; the alternative is silence.
 */
@Injectable()
export class PersonaRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /**
     * Every persona this station has, oldest first.
     *
     * Keyed as a tiebreaker rather than decoration: the seeds are written in ONE insert, so all four
     * carry the same transaction timestamp and a sort on the stamp alone hands back whatever order
     * the planner felt like. A console list that reshuffles between reads is a page an operator
     * cannot use.
     */
    async list(): Promise<Persona[]> {
        const rows = await this.db
            .selectFrom('deadair.personas')
            .selectAll()
            .where('stationKey', '=', this.station.stationKey)
            .orderBy('createdAt', 'asc')
            .orderBy('key', 'asc')
            .execute();

        return rows.map(toPersona);
    }

    async find(id: string): Promise<Persona | undefined> {
        const row = await this.db
            .selectFrom('deadair.personas')
            .selectAll()
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return row === undefined ? undefined : toPersona(row);
    }

    /**
     * The persona on air, or `undefined` for a station that has chosen none.
     *
     * `undefined` is an ordinary answer and not a fault: it is what a station whose operator deleted
     * every persona gets, and everything downstream of this treats it as the station it was before
     * personas existed rather than as something to fail over.
     */
    async active(): Promise<Persona | undefined> {
        const row = await this.db
            .selectFrom('deadair.personas')
            .selectAll()
            .where('stationKey', '=', this.station.stationKey)
            .where('active', '=', true)
            .executeTakeFirst();

        return row === undefined ? undefined : toPersona(row);
    }

    /**
     * Who is presenting right now: this broadcast's own host, or the station's.
     *
     * The one place that precedence lives, because both readers — the break writer and the record
     * chooser — have to agree about who is on or the show has a different DJ depending on which one
     * you ask. A show names its host; a station names its default; and a named host that has since
     * been DELETED falls back rather than leaving the broadcast without one, which is the same
     * decision `on delete set null` makes on the column.
     */
    async presenting(lineupPersonaId: string | undefined): Promise<Persona | undefined> {
        if (lineupPersonaId === undefined) return this.active();

        return (await this.find(lineupPersonaId)) ?? this.active();
    }

    async create(draft: PersonaDraft): Promise<Persona> {
        const row = await this.db
            .insertInto('deadair.personas')
            .values({ stationKey: this.station.stationKey, ...columnsOf(draft) })
            .returningAll()
            .executeTakeFirstOrThrow();

        return toPersona(row);
    }

    /** Answers `undefined` for a persona this station does not have, which is a 404 and not a throw. */
    async update(id: string, draft: PersonaDraft): Promise<Persona | undefined> {
        const row = await this.db
            .updateTable('deadair.personas')
            .set(columnsOf(draft))
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .returningAll()
            .executeTakeFirst();

        return row === undefined ? undefined : toPersona(row);
    }

    /** Whether there was one to delete. The active one going is legitimate; see {@link active}. */
    async remove(id: string): Promise<boolean> {
        const result = await this.db
            .deleteFrom('deadair.personas')
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return (result.numDeletedRows ?? 0n) > 0n;
    }

    /**
     * Put one on air, taking the other off.
     *
     * Two statements, and the ORDER is forced by the unique index rather than chosen: setting the
     * new one first collides with the persona already active. They are atomic because the request
     * they run in is already a transaction — `audit.context.middleware` opens one around every
     * request and the scoped `Kysely` a repository holds IS that transaction, so opening a second
     * here throws rather than nesting.
     *
     * Answers `undefined` when there was nothing to put on air, so a caller can tell a 404 from a
     * success.
     */
    async setActive(id: string): Promise<Persona | undefined> {
        await this.db
            .updateTable('deadair.personas')
            .set({ active: false })
            .where('stationKey', '=', this.station.stationKey)
            .where('active', '=', true)
            .execute();

        const row = await this.db
            .updateTable('deadair.personas')
            .set({ active: true })
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .returningAll()
            .executeTakeFirst();

        return row === undefined ? undefined : toPersona(row);
    }

    /**
     * Write the seeds, for a station that has no personas at all.
     *
     * Guarded on the station being EMPTY rather than on each key being absent, which is the
     * difference between a seed and a default: an operator who deleted the pirate did so on purpose,
     * and a boot that quietly put it back would make deletion impossible to express. Answers how
     * many were written, which is zero on every boot after the first.
     *
     * The read-then-write is not locked, and the backstop is `personas_key_unique` rather than a
     * transaction: two processes booting into the same empty station would both find it empty, and
     * the second one's insert then does nothing instead of writing a second pirate. That is the
     * whole of the race, and paying for it with a lock would mean opening a transaction — which is
     * the one thing a repository here must not do, since the request path hands it one already.
     */
    async seed(drafts: readonly PersonaDraft[], activeKey: string): Promise<number> {
        if (drafts.length === 0) return 0;

        const existing = await this.db
            .selectFrom('deadair.personas')
            .select('id')
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        if (existing !== undefined) return 0;

        const rows = await this.db
            .insertInto('deadair.personas')
            .values(
                drafts.map(draft => ({
                    stationKey: this.station.stationKey,
                    ...columnsOf(draft),
                    active: draft.key === activeKey,
                })),
            )
            .onConflict(conflict => conflict.columns(['stationKey', 'key']).doNothing())
            .returning('id')
            .execute();

        return rows.length;
    }

    /**
     * Write the seeds this station does not already have, whatever else it has.
     *
     * The deliberate exception to {@link seed}'s emptiness guard, and the reason it is safe is that
     * nothing calls it on its own: an operator asked. A boot that quietly restored a deleted persona
     * would make deletion inexpressible, but an operator pressing "restore" is saying exactly what
     * they want, and a station that has been running since before a seed was written has no other
     * way to reach it.
     *
     * **A persona that already exists is left completely alone**, including one an operator has
     * rewritten under a seeded key — the conflict does nothing rather than updating, so this can
     * never overwrite somebody's work with the shipped sheet. Nothing is put on air either: what is
     * already there stays there. Answers the keys it actually wrote.
     */
    async restoreMissing(drafts: readonly PersonaDraft[]): Promise<string[]> {
        if (drafts.length === 0) return [];

        const rows = await this.db
            .insertInto('deadair.personas')
            .values(drafts.map(draft => ({ stationKey: this.station.stationKey, ...columnsOf(draft), active: false })))
            .onConflict(conflict => conflict.columns(['stationKey', 'key']).doNothing())
            .returning('key')
            .execute();

        return rows.map(row => row.key);
    }
}

/** A draft as columns. `active` is deliberately absent: it moves through {@link PersonaRepository.setActive} alone. */
function columnsOf(draft: PersonaDraft) {
    return {
        key: draft.key,
        label: draft.label,
        style: draft.style,
        djName: draft.djName ?? null,
        voice: draft.voice ?? null,
        background: draft.background ?? null,
        templates: draft.templates ?? null,
        music: draft.music ?? null,
        brevity: draft.brevity ?? null,
        diction: jsonOf(draft.diction),
        dictionMarkers: jsonOf(draft.dictionMarkers),
        quirks: jsonOf(draft.quirks),
        catchphrases: jsonOf(draft.catchphrases),
        avoid: jsonOf(draft.avoid),
        samples: jsonOf(draft.samples),
    };
}

const jsonOf = (values: readonly string[] | undefined) => sql<string>`${JSON.stringify(values ?? [])}::jsonb`;

/**
 * A stored list, or `undefined` when the column holds something that is not one.
 *
 * Empty answers `undefined` too, so an unset facet and one an operator cleared are the same thing to
 * the sheet renderer — which is right, because they are the same thing to a listener.
 */
function stringsIn(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;

    const strings = value.filter((entry): entry is string => typeof entry === 'string');
    return strings.length === 0 ? undefined : strings;
}

/** Read back as `undefined` rather than `null`, per the note in CLAUDE.md, so `== null` is the test. */
function toPersona(row: {
    id: string;
    key: string;
    label: string;
    style: string;
    active: boolean;
    djName: string | null;
    voice: string | null;
    background: string | null;
    templates: string | null;
    music: string | null;
    brevity: string | null;
    diction: unknown;
    dictionMarkers: unknown;
    quirks: unknown;
    catchphrases: unknown;
    avoid: unknown;
    samples: unknown;
}): Persona {
    const list = (value: unknown, key: string): Record<string, string[]> => {
        const strings = stringsIn(value);
        return strings === undefined ? {} : { [key]: strings };
    };

    return {
        id: row.id,
        key: row.key,
        label: row.label,
        style: row.style,
        active: row.active,
        ...(row.djName == null ? {} : { djName: row.djName }),
        ...(row.voice == null ? {} : { voice: row.voice }),
        ...(row.background == null ? {} : { background: row.background }),
        ...(row.templates == null ? {} : { templates: row.templates }),
        ...(row.music == null ? {} : { music: row.music }),
        // Checked rather than cast, because the column is plain text and a row edited by hand could
        // otherwise put an unknown rung in front of a model as an instruction.
        ...(isPersonaBrevity(row.brevity) ? { brevity: row.brevity } : {}),
        ...list(row.diction, 'diction'),
        ...list(row.dictionMarkers, 'dictionMarkers'),
        ...list(row.quirks, 'quirks'),
        ...list(row.catchphrases, 'catchphrases'),
        ...list(row.avoid, 'avoid'),
        ...list(row.samples, 'samples'),
    };
}
