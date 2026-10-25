import type { ScheduleSlotApplied, ScheduleSlotPart } from '@deadair/sdk';

import { formatList } from '../../i18n/format.locale';
import { i18n } from '../../i18n/i18n.setup';

/** The parts only a changeover brings about, which are the only ones the station answers as waiting. */
const WAITING_PARTS = ['source', 'mode', 'onEnd', 'coHosts'] as const;

const isWaitingPart = (part: ScheduleSlotPart): part is (typeof WAITING_PARTS)[number] => (WAITING_PARTS as readonly string[]).includes(part);

/**
 * What to tell the operator after a slot was applied to the show on air, and whether it is news of
 * something done or of something queued.
 *
 * Queued when the records are being chosen again, because that half has not happened yet: the old
 * ones keep playing until the new set is ready, and reporting it as done is how an operator ends up
 * waiting for something they think already happened. What could not change mid-show is named in the
 * same message, since otherwise an operator who changed the source would wait for a playlist that is
 * not coming until the next occurrence.
 */
export function describeApplied(answer: ScheduleSlotApplied): { message: string; queued: boolean } {
    const waiting = answer.waiting.flatMap(part => (isWaitingPart(part) ? [i18n.t(`schedule:slot.apply.parts.${part}`)] : []));
    const tail = waiting.length === 0 ? '' : ` ${i18n.t('schedule:slot.apply.waiting', { parts: formatList(waiting) })}`;

    if (answer.applied.length === 0) return { message: `${i18n.t('schedule:slot.apply.unchanged')}${tail}`, queued: false };
    if (answer.replanning) return { message: `${i18n.t('schedule:slot.apply.replanning')}${tail}`, queued: true };
    return { message: `${i18n.t('schedule:slot.apply.done')}${tail}`, queued: false };
}
