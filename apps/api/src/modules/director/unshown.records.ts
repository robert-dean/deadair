import { unshownRecordIn, type AnswerGuard } from './break.answer.guard.js';
import type { BreakWriteRequest } from './break.writer.js';

/**
 * The records a news, weather or welcome script may not hand over to, as a guard field.
 *
 * `BreakWriteRequest.lately` with one thing taken out: a record the break's OWN substrate names.
 * A bulletin reporting a story about a band the station played an hour ago is reading the news, and
 * refusing it would be refusing the bulletin for being correct. So a record whose title and artist
 * the stories carry is not judged at all. Compared the loose way (inflected, as outside English),
 * because a miss here costs a refusal and a match only spares one.
 *
 * Shared by the three model writers so they cannot judge the same request differently. Absent when
 * nothing is left, which is the guard's way of not asking.
 */
export function unshownGuard(request: Pick<BreakWriteRequest, 'lately' | 'stories'>): Pick<AnswerGuard, 'unshown'> {
    const lately = request.lately ?? [];
    if (lately.length === 0) return {};

    const substrate = (request.stories ?? [])
        .flatMap(story => [story.headline, story.summary, story.body])
        .filter((text): text is string => text !== undefined && text.trim() !== '')
        .join(' ');
    const unshown = substrate === '' ? lately : lately.filter(record => unshownRecordIn(substrate, [record], 'substrate') === undefined);

    return unshown.length === 0 ? {} : { unshown };
}
