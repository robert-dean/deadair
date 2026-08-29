/**
 * Reading somebody else's JSON without trusting a field of it.
 *
 * Every provider here parses a shape it does not control, and the rule they all
 * follow is that a field which is not what it should be produces nothing rather
 * than a throw or a zero. A zero is the dangerous one: a temperature that is
 * absent and a temperature that is freezing are the same number and very
 * different sentences, which is why every measurement in
 * `capabilities/weather.ts` is optional and why nothing here ever invents one.
 */

/** One property of something that may not be an object at all. */
export const field = (value: unknown, key: string): unknown =>
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;

/**
 * A number a service actually reported, to one decimal.
 *
 * Rounded because these are read out loud: nobody says "eleven point three
 * seven degrees", and a figure carried at full precision through a conversion
 * arrives at a model looking like a measurement somebody made.
 */
export function reading(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return Math.round(value * 10) / 10;
}

/** A whole-number percentage between 0 and 100, or nothing. */
export function percentage(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return Math.min(100, Math.max(0, Math.round(value)));
}

/** Metres per second as kilometres per hour, which is what the capability asks for. */
export const kphFromMetresPerSecond = (value: unknown): number | undefined => {
    const speed = reading(value);
    return speed === undefined ? undefined : reading(speed * 3.6);
};

/** Text a service actually sent, trimmed. Blank is the same as absent. */
export const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);

/**
 * `undefined` means "not set", so the key is left off rather than written with
 * nothing behind it.
 *
 * The plugin SDK's rule, and the shape every builder here uses to honour it in
 * an object literal.
 */
export const optional = <TKey extends string, TValue>(key: TKey, value: TValue | undefined): Partial<Record<TKey, TValue>> =>
    value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);

/**
 * A local time and its offset, as one ISO-8601 instant.
 *
 * Two of the three services report times in the PLACE's own zone with no offset
 * on them, which is a string a reader can misread by a whole working day. The
 * offset is reported separately, so this is where they are put back together —
 * and it is worth doing rather than asking for UTC, because the other half of
 * what these services report is a calendar DATE at the place, and a forecast for
 * "tomorrow" moves a day if it is read in UTC.
 *
 * Returns `undefined` for a time it cannot read, so a missing sunrise is a
 * missing field rather than the words `Invalid Date` reaching a microphone.
 */
export function withOffset(localTime: unknown, offsetSeconds: number): string | undefined {
    const time = text(localTime);
    if (time === undefined) return undefined;

    // Already carries a zone: leave it exactly as the service sent it.
    if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(time)) return time;

    const withSeconds = /T\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(withSeconds)) return undefined;

    return `${withSeconds}${offsetLabel(offsetSeconds)}`;
}

/** A number of seconds as `+02:00`, `-05:00` or `Z`. */
function offsetLabel(offsetSeconds: number): string {
    if (!Number.isFinite(offsetSeconds) || offsetSeconds === 0) return 'Z';

    const sign = offsetSeconds < 0 ? '-' : '+';
    const total = Math.abs(Math.trunc(offsetSeconds));
    const hours = Math.floor(total / 3_600);
    const minutes = Math.floor((total % 3_600) / 60);
    return `${sign}${pad(hours)}:${pad(minutes)}`;
}

/** The calendar day an instant falls on, at a place that many seconds off UTC. */
export function localDate(epochSeconds: unknown, offsetSeconds: number): string | undefined {
    if (typeof epochSeconds !== 'number' || !Number.isFinite(epochSeconds)) return undefined;

    const shifted = new Date((Math.trunc(epochSeconds) + Math.trunc(offsetSeconds || 0)) * 1_000);
    if (Number.isNaN(shifted.getTime())) return undefined;

    // Read in UTC after shifting, which is the whole trick: the offset has
    // already moved the instant to the place's own wall clock, so UTC now reads
    // that clock rather than the server's.
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** An epoch second count as an ISO-8601 instant at a place that many seconds off UTC. */
export function localInstant(epochSeconds: unknown, offsetSeconds: number): string | undefined {
    const date = localDate(epochSeconds, offsetSeconds);
    if (date === undefined) return undefined;

    const shifted = new Date((Math.trunc(epochSeconds as number) + Math.trunc(offsetSeconds || 0)) * 1_000);
    const time = `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
    return `${date}T${time}${offsetLabel(offsetSeconds)}`;
}

const pad = (value: number): string => String(value).padStart(2, '0');
