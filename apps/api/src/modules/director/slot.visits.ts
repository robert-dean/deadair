import { addDays, dateKey, MAX_CO_HOSTS, startsOn, type ScheduleSlot, type SlotPerson, type StationDate } from './schedule.js';

/**
 * Who is on a slot on a given night, besides its host: a guest host sitting in, and (later) the
 * co-hosts beside it.
 *
 * ## Random without being stored
 *
 * "About one night in seven" is meant to feel unscheduled, and the obvious way to do that is to roll
 * a die at each changeover and write the answer down. That answer would then be a second piece of
 * state about what airs, kept beside the running order, and the console would have no way to say
 * who is on next Friday without guessing. So the roll is a pure function of the slot, the person and
 * the DATE the night began on: a hash, compared against `1 / everyN`. The tick, the timetable and
 * the Today strip all get the same answer for the same night, the tick asking every minute can never
 * flip the host mid-show, and a restart changes nothing. This is the `stationTargetMs` rule ("roll
 * once and keep it") reached by being deterministic instead of by storing.
 *
 * ## The cooldown counts real appearances, and is paid for out of the odds
 *
 * A raw roll at one in seven turns up two nights running often enough to notice, and a visitor at one
 * in twenty-five could still appear twice in a fortnight. So after an appearance a person sits out
 * `cooldownDays`. Checking that against earlier RAW rolls (stateless, no history) was tried first and
 * was wrong: a win was refused whenever any earlier night's roll had won, refused or not, so a long
 * cooldown starved the odds. At one in four with a fortnight's cooldown a visitor came twice in two
 * years. Instead the appearances are walked forward from a fixed {@link EPOCH}, each one deciding
 * the next: still a pure function of the slot, the person and the date, just one that reads the
 * nights before it.
 *
 * And the nightly chance is raised to pay for the cooldown, so `everyN` stays the AVERAGE gap an
 * operator asked for: a person who must sit out `c` nights and then wins each night at `1/(n - c)`
 * comes back after `c + (n - c) = n` nights on average. A cooldown as long as the odds or longer
 * leaves nothing random, and the person comes every `cooldown + 1` nights like clockwork.
 */

/** The fewest days between two random appearances when a row does not say: half the average gap. */
export const defaultCooldown = (everyN: number): number => Math.floor(everyN / 2);

/**
 * Whether a person is on a slot on the night that began on `date`.
 *
 * A row with neither days nor odds is on every night, which is a co-host's ordinary shape. Fixed
 * days are read against the weekday the night BEGAN on, so a late show's guest on Fridays is still
 * on after midnight.
 */
export function appears(person: SlotPerson, slot: ScheduleSlot, date: StationDate): boolean {
    if (person.everyN === undefined) {
        return person.days === undefined || person.days.length === 0 || person.days.includes(date.weekday);
    }

    return lastAppearance(person as SlotPerson & { everyN: number }, slot, date) === dateKey(date);
}

/**
 * The first night the walk starts from. Fixed, so every reader walks the same nights; a night
 * before it is judged on its roll alone, with nobody earlier to have cooled down from.
 */
const EPOCH: StationDate = { year: 2024, month: 1, day: 1, weekday: 1 };

/**
 * The last night on or before `date` that a random person appeared on, as `YYYY-MM-DD`, or
 * `undefined` for none.
 *
 * About two thousand steps for a date a few years past {@link EPOCH}, each a hash: a minute's tick
 * and a week's timetable both afford it, and nothing is kept between calls.
 */
function lastAppearance(person: SlotPerson & { everyN: number }, slot: ScheduleSlot, date: StationDate): string | undefined {
    const cooldown = person.cooldownDays ?? defaultCooldown(person.everyN);
    const chance = cooldown >= person.everyN - 1 ? 1 : 1 / (person.everyN - cooldown);
    const target = dateKey(date);

    if (target < dateKey(EPOCH)) return startsOn(slot, date) && wins(person, slot, date, chance) ? target : undefined;

    let last: StationDate | undefined;
    for (let day = EPOCH; dateKey(day) <= target; day = addDays(day, 1)) {
        const rested = last === undefined || daysBetween(last, day) > cooldown;
        if (rested && startsOn(slot, day) && wins(person, slot, day, chance)) last = day;
    }

    return last === undefined ? undefined : dateKey(last);
}

/** Whole days from one station date to a later one. Civil arithmetic through UTC, as `addDays` does. */
const daysBetween = (from: StationDate, to: StationDate): number =>
    Math.round((Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / 86_400_000);

/** Who presents a night of a slot, and whose show it usually is when that is somebody else. */
export interface NightHost {
    /** Who presents. Absent is the station's own host, as on a slot that names none. */
    personaId?: string;
    /** The slot's own host while a guest sits in for them; absent on an ordinary night. */
    regularPersonaId?: string;
    /** Whether this night is a guest host's. */
    guest: boolean;
}

/**
 * Who presents the night of `slot` that began on `date`.
 *
 * A guest on fixed nights first, because somebody wrote that night down; then a random guest whose
 * roll wins, in row order; then the slot's own host. The regular host is named only while a guest
 * sits in, and is the slot's own host or absent for a slot the station's host presents, which the
 * writers read as "the station's own".
 */
export function hostFor(slot: ScheduleSlot, date: StationDate): NightHost {
    const guests = slot.guestHosts ?? [];
    const fixed = guests.find(person => person.everyN === undefined && (person.days?.length ?? 0) > 0 && appears(person, slot, date));
    const guest = fixed ?? guests.find(person => person.everyN !== undefined && appears(person, slot, date));

    if (guest === undefined || guest.personaId === slot.personaId) {
        return { ...(slot.personaId === undefined ? {} : { personaId: slot.personaId }), guest: false };
    }

    return { personaId: guest.personaId, ...(slot.personaId === undefined ? {} : { regularPersonaId: slot.personaId }), guest: true };
}

/**
 * Who presents beside the night's host, in the slot's own order: every co-host whose night it is
 * (always, on their fixed nights, or a visitor whose roll wins), never the night's host themselves,
 * and at most {@link MAX_CO_HOSTS}. A visitor who wins a night that is already full sits it out; the
 * permanent co-hosts come first because they are listed first by the operator who wrote them down.
 */
export function coHostsFor(slot: ScheduleSlot, date: StationDate, presenter: string | undefined): string[] {
    const on: string[] = [];

    for (const person of slot.coHosts ?? []) {
        if (on.length >= MAX_CO_HOSTS) break;
        if (person.personaId === presenter || on.includes(person.personaId)) continue;
        if (appears(person, slot, date)) on.push(person.personaId);
    }

    return on;
}

/** Whether a person's roll wins the night that began on `date` at this chance, ignoring the cooldown. */
function wins(person: SlotPerson, slot: ScheduleSlot, date: StationDate, chance: number): boolean {
    return roll(`${slot.id}|${person.personaId}|${dateKey(date)}`) < chance;
}

/**
 * A number in [0, 1) from a string, the same on every machine and every run.
 *
 * FNV-1a, 32-bit, then one round of a finalising mix so that two dates a day apart do not land
 * close together: FNV alone moves only the low bits for a one-character change at the end.
 */
export function roll(key: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < key.length; index++) {
        hash ^= key.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }

    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;

    return (hash >>> 0) / 0x1_0000_0000;
}
