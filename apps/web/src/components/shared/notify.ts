import { notifications } from '@mantine/notifications';

import { toneColor } from './status';

/**
 * Telling the operator that the thing they asked for happened.
 *
 * Most mutations in this console reported nothing at all. Rating a record, putting a character on
 * air, accepting a pronunciation, enabling a plugin: the request went, the list eventually redrew,
 * and in between there was no difference between a save that worked and a click that missed. The
 * one page that did say so said it in dimmed text beside its own button, which works there and does
 * not generalise to a row action halfway down a table.
 *
 * ## Success only, deliberately
 *
 * A failure stays an `ErrorAlert` on the page. Two reasons, and the second is the real one: an error
 * needs to persist until it is dealt with, where the whole point of this is that it leaves; and an
 * alert can carry what the server actually said, where a toast has room for a sentence the console
 * wrote. A toast reporting a failure would be a worse version of a thing that already works.
 *
 * ## Why these are functions rather than a component
 *
 * The moment worth reporting is inside a mutation callback rather than in a render, which is exactly
 * where a component cannot be. Keeping them here also keeps the wording in one place: every one of
 * these is the station's own voice and they should sound like each other.
 */

/** What a save says. The label names the thing, so the sentence stays out of the caller. */
export function notifySaved(what: string): void {
    notifications.show({
        message: `${what} saved.`,
        color: toneColor.ok,
        autoClose: 3000,
        withBorder: true,
    });
}

/**
 * What an action that is not a save says.
 *
 * The caller supplies the whole sentence, because these are all different: a character went on air,
 * a refill was asked for, a copy was written off. There is no template that covers them and one
 * would only produce station copy nobody chose.
 */
export function notifyDone(message: string): void {
    notifications.show({
        message,
        color: toneColor.ok,
        autoClose: 3000,
        withBorder: true,
    });
}

/**
 * An action that was accepted but has not happened yet.
 *
 * Its own function rather than a parameter on the two above, because the claim is different and the
 * difference matters on a desk: "saved" is a fact about a row that is now on disk, and this is a
 * fact about a request the station has taken and will act on in its own time. A refill that is
 * queued and one that has produced records are not the same news, and reporting the first as the
 * second is how an operator ends up waiting for something they think already happened.
 */
export function notifyQueued(message: string): void {
    notifications.show({
        message,
        color: toneColor.standby,
        autoClose: 4000,
        withBorder: true,
    });
}
