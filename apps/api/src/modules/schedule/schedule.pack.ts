import type { DroppedEntry } from '#modules/topics/topic.pack.js';
import { hasKind, type Persona } from '#modules/personas/persona.js';
import { isRecurrence, overlap, type ScheduleSlot, type StationDate } from '#modules/director/schedule.js';
import { occasionRuleFields } from './occasion.rule.js';
import type { ScheduleSlotDraft } from './schedule.repository.js';
import { ScheduleSlotInput, type ScheduleSlot as WireSlot, type SchedulePack } from './types/schedule.types.js';

/** What says, in the file itself, what this is. The contract refuses anything else before this is reached. */
export const SCHEDULE_PACK_FORMAT = 'deadair.schedule';

/** The version of the document's shape. It moves only when the shape does, never with the station. */
export const SCHEDULE_PACK_VERSION = 1;

/** What a slot's references are checked against on this station. */
export interface ScheduleGround {
    held: readonly ScheduleSlot[];
    personas: readonly Pick<Persona, 'id' | 'key' | 'kinds'>[];
    playlists: readonly { id: string; name: string }[];
    pluginIds: ReadonlySet<string>;
    today: StationDate;
    /** The station's own reading of a body, which throws a sentence at one it refuses. */
    draftOf: (input: ScheduleSlotInput) => ScheduleSlotDraft;
}

/** What a file would do to a station that holds what it holds. */
export interface SchedulePackReading {
    adding: ScheduleSlotDraft[];
    /** The names of what the station already has. */
    skipped: string[];
    dropped: DroppedEntry[];
    notices: { kind: string; message: string }[];
}

/**
 * A schedule as one file. Each entry is a slot as the API writes it, with the two kinds of id that mean
 * nothing elsewhere swapped for what does: a character's `key`, and a station playlist's name. No `id`, and
 * no `enabled`, which is the importing operator's to decide. Nothing a slot has done travels either: where
 * it got to in a playlist, what was prepared for it, or which nights of a live show were armed.
 */
export function packOfSchedule(wire: readonly WireSlot[], ground: Pick<ScheduleGround, 'personas' | 'playlists'>): SchedulePack {
    const keys = new Map(ground.personas.map(persona => [persona.id, persona.key]));
    const names = new Map(ground.playlists.map(playlist => [playlist.id, playlist.name]));

    const person = <TPerson extends { personaId: string }>({ personaId, ...rest }: TPerson) => {
        const personaKey = keys.get(personaId);
        return personaKey === undefined ? undefined : { personaKey, ...rest };
    };
    const people = <TPerson extends { personaId: string }>(list: readonly TPerson[] | undefined) => {
        const carried = (list ?? []).map(person).filter(entry => entry !== undefined);
        return carried.length === 0 ? undefined : carried;
    };

    return {
        format: SCHEDULE_PACK_FORMAT,
        version: SCHEDULE_PACK_VERSION,
        name: 'Schedule',
        slots: wire.map(slot => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars -- what is left out is the point
            const { id, nextDate, enabled, personaId, sourceStationPlaylistId, coHosts, guestHosts, ...rest } = slot;
            const host = personaId === undefined ? undefined : keys.get(personaId);
            const playlist = sourceStationPlaylistId === undefined ? undefined : names.get(sourceStationPlaylistId);
            const carriedCoHosts = people(coHosts);
            const carriedGuests = people(guestHosts);

            return {
                ...rest,
                ...(host === undefined ? {} : { personaKey: host }),
                ...(playlist === undefined ? {} : { stationPlaylistName: playlist }),
                ...(carriedCoHosts === undefined ? {} : { coHosts: carriedCoHosts }),
                ...(carriedGuests === undefined ? {} : { guestHosts: carriedGuests }),
            };
        }),
    };
}

/**
 * Reads a file against what the station already has, and writes nothing.
 *
 * Only the header can make a file unusable, so each entry is read by itself, through the same reading of a
 * body the API's own writes use. A reference this station cannot honour is cleared and reported rather than
 * costing the slot (#6's rule on dangling references), except that a co-host or guest who is missing or is
 * not a host is left off the slot: keeping them would have the edit that turns the slot on refused.
 *
 * Everything lands switched off, so overlap has nothing to refuse yet. A slot that would clash with what is
 * on is said in the preview, so nobody finds out by trying.
 */
export function planSchedulePack(pack: SchedulePack, ground: ScheduleGround): SchedulePackReading {
    const seen = new Set(ground.held.map(identityOf));
    const running = ground.held.filter(slot => slot.off !== true);
    const reading: SchedulePackReading = { adding: [], skipped: [], dropped: [], notices: [] };

    pack.slots.forEach((entry, index) => {
        const named = typeof entry.label === 'string' ? entry.label.trim().slice(0, 80) : '';
        const name = named === '' ? `Entry ${index + 1}` : `"${named}"`;
        const drop = (reason: string) => reading.dropped.push({ entry: index + 1, ...(named === '' ? {} : { words: named }), reason });
        const note = (kind: string, message: string) => reading.notices.push({ kind, message });

        const { input, cleared } = inputOf(entry, ground);
        for (const { kind, message } of cleared) note(kind, `${name}: ${message}`);

        const parsed = ScheduleSlotInput.safeParse({ ...input, enabled: false });
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            drop(issue === undefined ? 'it could not be read' : `${issue.path.join('.') || 'the entry'}: ${issue.message}`);
            return;
        }

        let draft: ScheduleSlotDraft;
        try {
            draft = ground.draftOf(parsed.data);
        } catch (error) {
            drop(refusalOf(error));
            return;
        }

        if (isOver(draft, ground.today)) {
            drop('its dates have passed');
            return;
        }

        const identity = identityOf(draft);
        if (seen.has(identity)) {
            reading.skipped.push(draft.label || named);
            return;
        }
        seen.add(identity);
        reading.adding.push(draft);

        const plugin = pluginOf(draft);
        if (plugin !== undefined && !ground.pluginIds.has(plugin)) {
            note('missing-plugin', `${name} plays from "${plugin}", which is not installed here.`);
        }
        const clash = running.find(slot => overlap({ ...draft, id: '' } as ScheduleSlot, slot, ground.today));
        if (clash !== undefined) {
            note('would-clash', `${name} overlaps "${clash.label}", so one of them has to change before it can be turned on.`);
        }
    });

    return reading;
}

/** An entry with its keys and names swapped back for this station's ids, and what could not be. */
function inputOf(entry: Record<string, unknown>, ground: ScheduleGround) {
    const { personaKey, stationPlaylistName, coHosts, guestHosts, ...rest } = entry;
    const cleared: { kind: string; message: string }[] = [];
    const input: Record<string, unknown> = { ...rest };

    const persona = typeof personaKey === 'string' ? ground.personas.find(candidate => candidate.key === personaKey) : undefined;
    if (persona !== undefined) input.personaId = persona.id;
    else if (typeof personaKey === 'string') {
        cleared.push({ kind: 'missing-host', message: `there is no character "${personaKey}" here, so the station's own host presents it.` });
    }

    if (typeof stationPlaylistName === 'string') {
        const matches = ground.playlists.filter(playlist => playlist.name === stationPlaylistName);
        if (matches.length === 1) input.sourceStationPlaylistId = matches[0]?.id;
        else
            cleared.push({
                kind: 'missing-playlist',
                message: `no one playlist here is called "${stationPlaylistName}", so the station fills it itself.`,
            });
    }

    const visitors = new Set(persona === undefined ? [] : [persona.id]);
    const peopleOf = (list: unknown) => {
        if (!Array.isArray(list)) return [];
        return list.flatMap((person: Record<string, unknown>) => {
            const { personaKey: key, ...when } = person;
            const found = ground.personas.find(candidate => candidate.key === key);
            if (found === undefined || !hasKind(found, 'host') || visitors.has(found.id)) {
                cleared.push({
                    kind: 'missing-host',
                    message: `"${String(key)}" is left off, as there is no host by that key free to present beside it.`,
                });
                return [];
            }
            visitors.add(found.id);
            return [{ personaId: found.id, ...when }];
        });
    };
    const carriedCoHosts = peopleOf(coHosts);
    const carriedGuests = peopleOf(guestHosts);
    if (carriedCoHosts.length > 0) input.coHosts = carriedCoHosts;
    if (carriedGuests.length > 0) input.guestHosts = carriedGuests;

    return { input, cleared };
}

/** A one-off special with its last date behind it. A yearly one or one on a rule comes round again. */
function isOver(draft: ScheduleSlotDraft, today: StationDate): boolean {
    if (draft.dates === undefined || isRecurrence(draft.dates) || draft.dates.yearly) return false;
    return draft.dates.to < stamp(today);
}

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
const stamp = (date: StationDate): string => `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;

/** The plugin a slot's records come from, when it names one. */
function pluginOf(draft: ScheduleSlotDraft): string | undefined {
    const source = draft.source;
    if (source === undefined) return undefined;
    if ('chartId' in source) return source.chartId.split(':')[0];
    return 'pluginId' in source ? source.pluginId : undefined;
}

/** What makes two slots the same show: its name and when it runs. Who hosts it or what it plays can differ. */
function identityOf(slot: Pick<ScheduleSlot, 'label' | 'startsAtMinutes' | 'endsAtMinutes' | 'days' | 'dates'>): string {
    const { dates } = slot;
    return JSON.stringify([
        slot.label.trim().toLowerCase(),
        slot.startsAtMinutes,
        slot.endsAtMinutes,
        [...slot.days].sort((left, right) => left - right),
        dates === undefined ? '' : isRecurrence(dates) ? canonical(occasionRuleFields(dates.rule)) : [dates.from, dates.to, dates.yearly],
    ]);
}

/** A rule's fields in one order, so two rules saying the same thing compare the same. */
const canonical = (fields: object): [string, unknown][] => Object.entries(fields).sort(([left], [right]) => left.localeCompare(right));

/** The sentence a refusal carries, wherever it keeps it. */
function refusalOf(error: unknown): string {
    const details = (error as { details?: { message?: unknown } }).details;
    if (typeof details?.message === 'string') return details.message;
    return error instanceof Error && error.message !== '' ? error.message : 'it could not be read';
}
