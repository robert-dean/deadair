import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { isSegmentExtension, type SegmentExtension } from './segment.store.js';

/** Whether a pad can be reached, or was turned down. */
export type PadState = 'active' | 'rejected';

/**
 * One sound on a board.
 *
 * `audioChecksum` and `audioExt` are required rather than a pair to be narrowed, which is the whole
 * difference between this and a {@link Segment} read as a state machine: a segment is planned before
 * it exists and a pad arrives as audio. A row with no file is not a pad in an earlier state, it is a
 * row nothing can produce, so the table refuses it and nothing here has to check.
 */
export interface Pad {
    id: string;
    board: string;
    /** What a script writes to hit this. Matched case-insensitively, so this is the stored spelling. */
    name: string;
    label: string;
    audioChecksum: string;
    audioExt: SegmentExtension;
    durationMs?: number;
    /**
     * How loud it came out, in LUFS, once something measured it.
     *
     * Matters more here than on a break and in the other direction: a pad is mastered by whoever
     * made it, and an air horn is mastered LOUD. Absent on a station with no analyzer, which is
     * ordinary — the join falls back to leaving the level alone.
     */
    loudnessLufs?: number;
    source: string;
    sourcePath?: string;
    /** When it was last chosen, as an ISO-8601 string. Absent for one never hit. */
    lastUsedAt?: string;
    state: PadState;
}

/** A pad as it arrives from the inbox: audio first, everything else described. */
export interface ImportedPad {
    board: string;
    name: string;
    label: string;
    sourcePath: string;
    audioChecksum: string;
    audioExt: SegmentExtension;
}

/**
 * What importing one file did.
 *
 * Three outcomes rather than {@link SegmentRepository.importFile}'s two, and the third is the
 * interesting one. See {@link PadRepository.importFile}.
 */
export type PadImport = 'created' | 'unchanged' | 'replaced';

/**
 * The station's soundboards: the short sounds a presenter reaches for.
 *
 * ## A pad is a SLOT, where a segment is a recording
 *
 * `SegmentRepository.importFile` dedups on the CHECKSUM, because two different files are two
 * different idents and an operator who drops both wants both. A pad is the opposite: the board has a
 * slot called `airhorn`, scripts name that slot, and dropping a better air horn in under the same
 * filename is REPLACING what the slot holds rather than adding a second thing to hit.
 *
 * So the identity is `(board, name)` and the checksum is a property of it, which is what makes
 * {@link PadImport}'s third outcome exist at all. Nothing about a script changes when the file does,
 * which is `segments.voice`'s indirection argument one level down.
 *
 * ## A pad is in the LIBRARY; a set is what reaches it
 *
 * `board` is where the file came from and decides nothing. What a presenter can hit is
 * `deadair.pad_sets`, which is many-to-many, so one air horn serves six characters without six
 * copies and one library can be cut two ways. See {@link PadSetRepository}.
 *
 * ## Everything a set is asked is asked in SQL
 *
 * {@link onSet} orders least-recently-hit first rather than handing a caller the rows to sort,
 * because the rotation is the point and two callers sorting differently is a rack whose rotation
 * depends on who asked. The same reason `PronunciationRepository.list` orders in SQL.
 */
@Injectable()
export class PadRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /**
     * One SET's reachable pads, least recently hit first.
     *
     * The read a break makes, and it takes the set's KEY rather than its id because that is what
     * `personas.soundboard` holds — a caller that had to resolve a key to an id first would be a
     * second read on the path of every break, to answer a question this join already answers.
     *
     * A key naming no set answers with nothing, which is deliberately the same answer as a set
     * holding nothing: both are a presenter with nothing to reach for, and nowhere downstream should
     * have to tell them apart.
     *
     * A pad never hit sorts first (`nulls first`), which is what stops a set's newest sound waiting
     * behind everything else for a full rotation before it is ever heard.
     */
    async onSet(key: string): Promise<Pad[]> {
        const rows = await this.db
            .selectFrom('deadair.pads as p')
            .innerJoin('deadair.padSetMembers as m', 'm.padId', 'p.id')
            .innerJoin('deadair.padSets as s', 's.id', 'm.setId')
            .selectAll('p')
            .where('p.stationKey', '=', this.station.stationKey)
            .where('s.key', '=', key.trim())
            .where('p.state', '=', 'active')
            .orderBy(sql`p.last_used_at asc nulls first`)
            .orderBy('p.name', 'asc')
            .execute();

        return rows.map(toPad);
    }

    /**
     * Every pad the station holds, or every pad on one board.
     *
     * Board then name, which is how the console draws it. Not the rotation order: an operator
     * looking at a rack wants it in a stable arrangement, and a list that reshuffles as the station
     * plays is a list nobody can find anything in twice.
     */
    async list(board?: string): Promise<Pad[]> {
        let query = this.db
            .selectFrom('deadair.pads')
            .selectAll()
            .where('stationKey', '=', this.station.stationKey)
            .orderBy('board', 'asc')
            .orderBy('name', 'asc');

        if (board !== undefined) query = query.where('board', '=', board);

        return (await query.execute()).map(toPad);
    }

    /**
     * Which boards the station actually holds pads on.
     *
     * What the persona page offers, and it answers from the pads rather than from a list of board
     * names somewhere, so a board exists exactly as long as something is on it. `distinct` in SQL
     * for {@link SegmentRepository.readyKinds}' reason: the answer is a handful of words either way,
     * and the alternative drags every row across to build a set.
     */
    async boards(): Promise<string[]> {
        const rows = await this.db
            .selectFrom('deadair.pads')
            .select('board')
            .distinct()
            .where('stationKey', '=', this.station.stationKey)
            .where('state', '=', 'active')
            .orderBy('board', 'asc')
            .execute();

        return rows.map(row => row.board);
    }

    /** One pad, whatever state it is in. What the audio route reads. */
    async findById(id: string): Promise<Pad | undefined> {
        const row = await this.db
            .selectFrom('deadair.pads')
            .selectAll()
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return row === undefined ? undefined : toPad(row);
    }

    /**
     * The pad a script named, if this SET holds one under that name.
     *
     * Case-insensitively and trimmed, because a model handed a list of names does not reliably give
     * one back in the case it was offered in. `rejected` rows are excluded here rather than by the
     * caller: a turned-down pad is exactly as unreachable as one that was never there, and a script
     * naming it should be treated as naming nothing.
     *
     * **Ordered, and that is not decoration.** `PadSetRepository.add` refuses a name a set already
     * answers to, so this should never see two — but the rule spans a join and cannot be an index, so
     * a row that got in another way must not make one script sound different between two renders.
     * Oldest first, which is the one that was there when the name started meaning something.
     */
    async named(setKey: string, name: string): Promise<Pad | undefined> {
        const row = await this.db
            .selectFrom('deadair.pads as p')
            .innerJoin('deadair.padSetMembers as m', 'm.padId', 'p.id')
            .innerJoin('deadair.padSets as s', 's.id', 'm.setId')
            .selectAll('p')
            .where('p.stationKey', '=', this.station.stationKey)
            .where('s.key', '=', setKey.trim())
            .where('p.state', '=', 'active')
            .where(sql<boolean>`lower(btrim(p.name)) = lower(btrim(${name}))`)
            .orderBy('p.createdAt', 'asc')
            .executeTakeFirst();

        return row === undefined ? undefined : toPad(row);
    }

    /**
     * The pad this directory already holds under a name, if any.
     *
     * The import path's own question, matching `pads_name_idx` exactly — same station, same board,
     * case-insensitive, and `rejected` excluded because the index is partial on it. An operator who
     * turned an air horn down and dropped a better one in gets a new pad rather than a refusal.
     */
    private async inBoard(board: string, name: string): Promise<Pad | undefined> {
        const row = await this.db
            .selectFrom('deadair.pads')
            .selectAll()
            .where('stationKey', '=', this.station.stationKey)
            .where('board', '=', board)
            .where('state', '=', 'active')
            .where(sql<boolean>`lower(btrim(name)) = lower(btrim(${name}))`)
            .executeTakeFirst();

        return row === undefined ? undefined : toPad(row);
    }

    /**
     * Take one file into the rack, and say what that did.
     *
     * Read-then-write rather than an upsert, because the conflict target is an expression index
     * (`lower(btrim(name))`) and spelling that out in an `on conflict` clause is a second copy of
     * the index definition that can drift from the first. The race it leaves open is two scans of
     * one inbox at the same instant, which is a thing the station does not do.
     *
     * `unchanged` and `replaced` are told apart deliberately: a re-scan of a directory nobody has
     * touched must be silent, and one where a file actually changed under a name the station is
     * already saying is worth a line in the log.
     */
    async importFile(imported: ImportedPad): Promise<{ pad: Pad; outcome: PadImport }> {
        // By DIRECTORY and not by set, which is the whole of what this method is about: a second
        // `airhorn.wav` in one folder replaces the first, and in another folder it is a second pad.
        // {@link named} answers the other question — what a SCRIPT can reach — and using it here
        // would make importing depend on a set existing, so the first file in a new directory would
        // never find the row it had just written.
        const existing = await this.inBoard(imported.board, imported.name);

        if (existing !== undefined) {
            if (existing.audioChecksum === imported.audioChecksum) return { pad: existing, outcome: 'unchanged' };

            const replaced = await this.db
                .updateTable('deadair.pads')
                .set({
                    label: imported.label,
                    sourcePath: imported.sourcePath,
                    audioChecksum: imported.audioChecksum,
                    audioExt: imported.audioExt,
                    // Both measurements belong to the FILE rather than to the slot, so a replacement
                    // arrives unmeasured. Leaving the old numbers would level the new sound against
                    // the old one, which is the failure this column exists to prevent.
                    durationMs: null,
                    loudnessLufs: null,
                })
                .where('id', '=', existing.id)
                .returningAll()
                .executeTakeFirstOrThrow();

            return { pad: toPad(replaced), outcome: 'replaced' };
        }

        const row = await this.db
            .insertInto('deadair.pads')
            .values({
                stationKey: this.station.stationKey,
                board: imported.board,
                name: imported.name,
                label: imported.label,
                source: LIBRARY_SOURCE,
                sourcePath: imported.sourcePath,
                audioChecksum: imported.audioChecksum,
                audioExt: imported.audioExt,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        return { pad: toPad(row), outcome: 'created' };
    }

    /**
     * Rest a pad, because something has just chosen it.
     *
     * At SELECTION rather than after the break airs, which is `chooseFacts`' documented inaccuracy
     * taken deliberately for its reason: the alternative is a second writer downstream that can
     * disagree with this one about what was spent. A break dropped before its slot has still rested
     * its pad, and a rested pad is one somebody else gets a turn with.
     */
    async markUsed(id: string): Promise<void> {
        await this.db
            .updateTable('deadair.pads')
            .set({ lastUsedAt: sql`now()` })
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .execute();
    }

    /**
     * What the analyzer said about one pad's audio.
     *
     * Written after the row exists rather than as part of importing it, exactly as a segment's
     * loudness is: the file is on the rack and reachable the moment it is imported, and how loud it
     * is can catch up.
     */
    async measured(id: string, measurement: { durationMs?: number; loudnessLufs?: number }): Promise<void> {
        await this.db
            .updateTable('deadair.pads')
            .set({
                durationMs: measurement.durationMs ?? null,
                loudnessLufs: measurement.loudnessLufs ?? null,
            })
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .execute();
    }

    /**
     * Turn a pad down, or put one back.
     *
     * A state rather than a deletion, on `pronunciations`' argument: the inbox scan re-reads the
     * directory, so a deleted row is back on the next pass and the operator's decision has to
     * outlive it. Rejecting one does not stop them putting a different sound under the same name,
     * which is what the unique index being partial is for.
     */
    async setState(id: string, state: PadState): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.pads')
            .set({ state })
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return Number(result.numUpdatedRows) > 0;
    }
}

/** What `source` says about a pad that arrived in the inbox. */
const LIBRARY_SOURCE = 'library';

/**
 * One row as a {@link Pad}.
 *
 * The extension is narrowed rather than trusted: the column is plain text, so a row written by
 * anything other than the importer could name a format the store cannot serve. An unrecognised one
 * falls back to `mp3` rather than being dropped, because a pad with an unreadable extension is a
 * file that will 404 loudly at the store, which is a better failure than a row that silently is not
 * on its own board.
 */
function toPad(row: {
    id: string;
    board: string;
    name: string;
    label: string;
    audioChecksum: string;
    audioExt: string;
    durationMs: number | null;
    loudnessLufs: number | null;
    source: string;
    sourcePath: string | null;
    lastUsedAt: { toISO(): string | null } | null;
    state: PadState;
}): Pad {
    return {
        id: row.id,
        board: row.board,
        name: row.name,
        label: row.label,
        audioChecksum: row.audioChecksum,
        audioExt: isSegmentExtension(row.audioExt) ? row.audioExt : 'mp3',
        ...(row.durationMs == null ? {} : { durationMs: row.durationMs }),
        ...(row.loudnessLufs == null ? {} : { loudnessLufs: row.loudnessLufs }),
        source: row.source,
        ...(row.sourcePath == null ? {} : { sourcePath: row.sourcePath }),
        ...(row.lastUsedAt == null ? {} : { lastUsedAt: row.lastUsedAt.toISO() ?? '' }),
        state: row.state,
    };
}
