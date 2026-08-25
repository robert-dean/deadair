import { SegmentedControl, Tooltip } from '@mantine/core';
import { IconMinus, IconThumbDown, IconThumbUp } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import type { ScriptRating } from '@deadair/sdk';

export interface ScriptRatingControlProps {
    /**
     * Absent means nobody has said, which is NOT `neutral`.
     *
     * The catalog's control defaults a missing rating to neutral, because every record has an
     * implicit position in the rotation whether or not anybody stated one. A break is different:
     * most attempts have never been read back, and drawing them as deliberately-no-opinion would
     * make an unreviewed history look like a reviewed one.
     */
    rating?: ScriptRating;
    onChange: (rating: ScriptRating) => void;
    /** A write is in flight. The control keeps its current answer rather than blanking. */
    busy?: boolean;
}

/**
 * What the operator thought of something the station said.
 *
 * The catalog's `RatingControl` mechanics exactly, and deliberately not that component: its hover
 * and screen-reader copy is baked in as "Never play X" and "Play X more often", which are claims
 * about rotation. Nothing acts on a script rating at all, so borrowing those words would promise a
 * consequence that does not exist. What is shared is the shape of the question, and that is one
 * sentence of reasoning rather than a component boundary worth abstracting over.
 *
 * A `SegmentedControl` for the same reason it is one next door: one question with three answers,
 * read as a single radio group rather than two unrelated switches, with `neutral` a segment of its
 * own so withdrawing an opinion is visible rather than a second click on the active side.
 */
export function ScriptRatingControl({ rating, onChange, busy = false }: ScriptRatingControlProps) {
    return (
        <SegmentedControl
            size="xs"
            // An unrated attempt shows no active segment at all, which is what tells it apart from
            // one an operator listened to and had no opinion about.
            value={rating ?? ''}
            disabled={busy}
            onChange={value => {
                onChange(value as ScriptRating);
            }}
            data={[
                {
                    value: 'disliked',
                    label: <Segment glyph={<IconThumbDown size={GLYPH} stroke={1.7} />} hint="The station should not say things like this" />,
                },
                {
                    value: 'neutral',
                    label: <Segment glyph={<IconMinus size={GLYPH} stroke={1.7} />} hint="Heard it, no opinion" />,
                },
                {
                    value: 'liked',
                    label: <Segment glyph={<IconThumbUp size={GLYPH} stroke={1.7} />} hint="More like this" />,
                },
            ]}
        />
    );
}

/** Matched to the feed's own small text, so a column of these does not out-shout the scripts. */
const GLYPH = 14;

/**
 * One option: a glyph, and what it means to anything not looking at it.
 *
 * The hint doubles as the accessible name here, where the catalog's version carries two strings.
 * That control sits on fifty rows naming fifty different records, so its label has to say WHICH one;
 * these three mean the same thing on every row, and the attempt they belong to is the sentence
 * immediately beside them.
 */
function Segment({ glyph, hint }: { glyph: ReactNode; hint: string }) {
    return (
        <Tooltip label={hint} openDelay={400}>
            <span aria-label={hint} style={{ display: 'flex' }}>
                {glyph}
            </span>
        </Tooltip>
    );
}
