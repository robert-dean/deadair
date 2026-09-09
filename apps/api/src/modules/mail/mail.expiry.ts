import { Duration } from 'luxon';

/**
 * How many minutes a message should say a code or link lasts.
 *
 * Every template that carries one says how long it has, and the figure has to come from the same
 * `Duration` the factor service actually expires it after — a template with `10` written into it is
 * a sentence that stops being true the first time somebody widens the setting, and the person it
 * misleads is holding a code that stopped working five minutes before the email said it would.
 *
 * Rounded UP, deliberately: a duration of 90 seconds reads as "2 minutes" rather than "1", so the
 * copy never promises less time than the code has. It is a reassurance, not a countdown, and a
 * whole number is what a sentence wants.
 */
export function expirationMinutes(expiration: Duration): number {
    return Math.max(1, Math.ceil(expiration.as('minutes')));
}
