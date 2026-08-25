import { SegmentedControl, Tooltip } from '@mantine/core';
import { IconMinus, IconThumbDown, IconThumbUp } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import type { Rating } from '@deadair/sdk';

export interface RatingControlProps {
    /**
     * Optional because the contract defaults it: a row answering without one has no opinion on it,
     * which is `neutral` rather than a missing value to draw around.
     */
    rating?: Rating;
    onChange: (rating: Rating) => void;
    /** What is being rated, for the labels a screen reader reads out. Not drawn. */
    label: string;
    /** A write is in flight. The control keeps its current answer rather than blanking. */
    busy?: boolean;
    size?: 'xs' | 'sm';
}

/**
 * What the station thinks of one artist, record or song.
 *
 * A `SegmentedControl` rather than a pair of toggle buttons, because this is one question with
 * three answers and Mantine's control already knows that: it is a radio group, so the arrow keys
 * move between the options and a screen reader reads it as one choice rather than as two unrelated
 * switches. Withdrawing an opinion is picking `neutral`, which is why it is a segment of its own
 * and not a second click on the active side — an operator should be able to see that the middle is
 * where they started.
 *
 * Deliberately NOT Mantine's `Rating`, which looks like the obvious component and is a star scale:
 * `count` items valued 1..count. Like and dislike are opposite poles rather than one and two stars,
 * and dressing them as a scale would put `disliked` below `neutral` on a widget that reads as
 * "less" rather than as "no".
 */
export function RatingControl({ rating = 'neutral', onChange, label, busy = false, size = 'sm' }: RatingControlProps) {
    return (
        <SegmentedControl
            size={size}
            value={rating}
            // `disabled` rather than unmounting or blanking: the answer on screen while the write is
            // in flight is still the one the operator can see they chose.
            disabled={busy}
            onChange={value => {
                onChange(value as Rating);
            }}
            data={[
                {
                    value: 'disliked',
                    label: <Segment glyph={<IconThumbDown size={GLYPH} stroke={1.7} />} hint={`Never play ${label}`} aria={`Dislike ${label}`} />,
                },
                {
                    value: 'neutral',
                    label: (
                        <Segment
                            glyph={<IconMinus size={GLYPH} stroke={1.7} />}
                            hint={`No opinion about ${label}`}
                            aria={`No opinion about ${label}`}
                        />
                    ),
                },
                {
                    value: 'liked',
                    label: <Segment glyph={<IconThumbUp size={GLYPH} stroke={1.7} />} hint={`Play ${label} more often`} aria={`Like ${label}`} />,
                },
            ]}
        />
    );
}

/** Matched to the table's body text, so a column of these does not out-shout the titles beside it. */
const GLYPH = 15;

/**
 * One option: a glyph, what it means on hover, and what it is called to anything not looking at it.
 *
 * These were emoji, because the app carried no icon set. Two thumbs in full colour on every row of a
 * fifty-artist table read as the loudest thing on the page, which is the wrong ranking for something
 * an operator uses occasionally — line icons inherit the segment's own colour and recede until they
 * are the active one. The `aria-label` is what the radio around it ends up called, so a page listing
 * fifty of these has fifty distinguishable controls rather than fifty identical ones.
 *
 * No `role="img"` on the span, deliberately. The name it carries belongs to the radio, and giving
 * the glyph a role of its own would put a thumb in the accessibility tree as a picture in its own
 * right — which is also how it started counting as artwork in the album page's "this record has no
 * cover" test.
 */
function Segment({ glyph, hint, aria }: { glyph: ReactNode; hint: string; aria: string }) {
    return (
        <Tooltip label={hint} openDelay={400}>
            <span aria-label={aria} style={{ display: 'flex' }}>
                {glyph}
            </span>
        </Tooltip>
    );
}
