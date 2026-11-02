import type { StationItemState, StationOrderItem } from '@deadair/sdk';

import { i18n } from '../../i18n/i18n.setup';

/** Whether an item is beyond editing: the player has it, or it is behind us. */
export const isSpent = (state: StationItemState): boolean => state !== 'planned';

/**
 * Whether the station can be skipped straight to this item.
 *
 * A RECORD still to come, and the API refuses anything else with a 422: a break's words are about
 * the records around it, so jumping into one would air a back-announce for a record just skipped.
 * `handed` counts, where it does not for a move or a drop, because the skip takes the player's
 * queue back itself.
 */
export const canSkipTo = (item: StationOrderItem): boolean => item.kind === 'track' && (item.state === 'planned' || item.state === 'handed');

/**
 * Whether a break can be written again from here.
 *
 * A break still to come that the station wrote: a failed one, which is the case the control exists
 * for since nothing else retries it, or one whose words have a writer. A recording has none, so it
 * is not offered, and one being written or spoken right now is left to finish. The API has the last
 * word, and refuses one turn of a programme, which this row cannot tell from a break.
 */
export const canRewrite = (item: StationOrderItem): boolean =>
    item.kind === 'segment' &&
    item.state === 'planned' &&
    item.overAtMs === undefined &&
    (item.segmentState === 'failed' || ((item.segmentState === 'written' || item.segmentState === 'ready') && item.segmentWriter !== undefined));

/**
 * The lowest position an item may be moved to, and the only one this table ever asks for.
 *
 * `lineup.move` refuses a `toIndex` below what has been committed rather than clamping it, on the
 * grounds that quietly reordering something a listener is about to hear is worse than saying no.
 * The console cannot see that boundary directly — it is the player's, not the order's — but the
 * first `planned` row is always at or above it, because everything ahead of it has either been
 * handed over or is behind us.
 *
 * -1 when there is nothing planned at all, which is a table with no move to offer.
 */
export function firstPlannedIndex(items: StationOrderItem[]): number {
    return items.findIndex(item => item.state === 'planned');
}

/**
 * How loud a row is, on the three-way split the running order actually has.
 *
 * Full for what is happening and what is still to come, half for the history an operator reads to
 * see where the station got to, and a quarter for a skipped SEGMENT — which is history that arrives
 * in runs. Four consecutive "News SEGMENT MODEL SKIPPED" lines at the same weight as the records
 * around them read as the running order rather than as the holes in it.
 *
 * Segments only. A skipped RECORD is a single row and is the more interesting fact of the two, since
 * the station had something to play and did not play it.
 */
export function opacityFor(item: StationOrderItem): number {
    if (item.state === 'airing' || item.state === 'planned') return 1;
    return item.state === 'skipped' && item.segmentId !== undefined ? 0.25 : 0.5;
}

/**
 * What decided a break's words, in a sentence.
 *
 * Free text on the row rather than a fixed set, because a station can install a writer this console
 * has never heard of. The two it does know are named; anything else is shown as it comes.
 */
export function writerHint(writer: string): string {
    if (writer === 'model') return i18n.t('onair:order.writer.model');
    if (writer === 'deterministic') return i18n.t('onair:order.writer.deterministic');
    return i18n.t('onair:order.writer.other', { writer });
}

/**
 * Whether a break will be heard, in the words the row puts on it.
 *
 * `playable` is one boolean standing in front of seven segment states, and the row used to spend all
 * seven of them on the same word. A break the station has simply not got round to writing is not a
 * fault — it is the normal condition of most of the order, because a break is written when it comes
 * round rather than when it is planted — so "will skip" on nine rows at once said the station was
 * failing when it was working exactly as designed. Three readings rather than one, because they are
 * the three an operator does something different about: wait, wait, and go and look.
 *
 * Grey for the two that are still coming, yellow only for the one that is not.
 */
export function skipReading(item: StationOrderItem): { label: string; colour: string; hint: string } | undefined {
    if (item.kind !== 'segment' || item.playable !== false || item.state !== 'planned') return undefined;

    if (item.segmentState === 'planned' || item.segmentState === 'writing') {
        return {
            label: i18n.t('onair:order.skip.notWritten'),
            colour: 'gray',
            hint: i18n.t('onair:order.skip.notWrittenHint'),
        };
    }

    if (item.segmentState === 'written' || item.segmentState === 'rendering') {
        return {
            label: i18n.t('onair:order.skip.noAudio'),
            colour: 'gray',
            hint: i18n.t('onair:order.skip.noAudioHint'),
        };
    }

    // `failed` and `gone`, plus the case the row carries no state at all. The reason when the row has
    // one: a break that could not be written and a DJ that simply talks less look identical without
    // it, and the difference is a sentence already on the segment.
    return {
        label: i18n.t('onair:order.skip.willSkip'),
        colour: 'yellow',
        // The state is the API's own word for it, carried rather than translated.
        hint: item.segmentError ?? i18n.t('onair:order.skip.willSkipHint', { state: item.segmentState ?? 'unavailable' }),
    };
}

/**
 * How each state reads to somebody at the desk.
 *
 * The words matter more than they look. "Handed over" is deliberately not "playing": the pusher
 * runs a lead ahead of the listener by design, so an item the player is holding may be two records
 * from being heard, and a console that called it "playing" would be a track ahead of the stream.
 * That mistake is the one this whole shape exists to make unrepresentable.
 */
const STATE_COLOUR: Record<Exclude<StationItemState, 'planned'>, string> = {
    handed: 'gray',
    airing: 'red',
    played: 'gray',
    skipped: 'yellow',
    // Split out of `skipped` because it is the only one of these an operator can act on. A skip is
    // the station making a decision it was designed to make; this is a record it could not get hold
    // of, which means a copy that would not serve — and the fix is out there, not in here.
    unavailable: 'orange',
    // Its own state rather than a shade of `skipped`, because it is the opposite fact: nothing
    // went wrong here. Grey rather than yellow for the same reason.
    removed: 'gray',
};

/** A state's legend, colour and tooltip, or nothing for a row that is simply still to come. The words are `onair:order.state`. */
export function stateReading(state: StationItemState): { label: string; colour: string; hint: string } | undefined {
    if (state === 'planned') return undefined;
    return {
        label: i18n.t(`onair:order.state.${state}.label`),
        colour: STATE_COLOUR[state],
        hint: i18n.t(`onair:order.state.${state}.hint`),
    };
}

/**
 * Which row the order is read FROM.
 *
 * The item on air when there is one. When there is not — a station stood down, or one that has been
 * put on and has not reached its first record yet — the first item nothing has spent, because "where
 * the station has got to" is the question either way and an operator should not have to hunt for it
 * in a played-out list.
 */
export function anchorOf(items: StationOrderItem[]): StationOrderItem | undefined {
    return items.find(item => item.state === 'airing') ?? items.find(item => item.state === 'planned' || item.state === 'handed');
}

/**
 * What the folded history is called, counting only what it actually holds.
 *
 * A broadcast that has only just started has history with nothing skipped in it, and "0 skipped" on
 * the desk is a zero an operator has to read and discard. Each clause appears when there is one.
 */
export function historyLabel(played: number, passed: number): string {
    const playedClause = played > 0 ? i18n.t('onair:order.history.played', { count: played }) : undefined;
    const passedClause = passed > 0 ? i18n.t('onair:order.history.skipped', { count: passed }) : undefined;
    // Neither, and yet there are rows behind the anchor: they are removals and hand-overs, which
    // are the two states that are neither played nor passed over. Naming the count is honest where
    // naming a state would not be.
    if (playedClause !== undefined && passedClause !== undefined) {
        return i18n.t('onair:order.history.both', { played: playedClause, skipped: passedClause });
    }
    return playedClause ?? passedClause ?? i18n.t('onair:order.history.earlier');
}
