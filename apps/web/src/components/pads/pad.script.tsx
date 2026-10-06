import { Badge, Text } from '@mantine/core';
import { Fragment } from 'react';

import { sfxToken } from './pad.upload.card';

/** One run of a script: words as they were written, or a pad hit by name. */
export type ScriptPart = { kind: 'text'; text: string } | { kind: 'pad'; name: string };

/**
 * The same shape the API's `padsIn` matches: lower-case letters, digits and hyphens, the one
 * spelling `padNameOf` produces from a filename. Anything else in brackets is words.
 */
const PAD_HIT = /\[sfx:([a-z0-9-]+)\]/gi;

/**
 * A script split around its pad hits, in order, with the words left exactly as written.
 *
 * Pure so the split can be tested without rendering. Empty runs are dropped, so a script that is
 * nothing but a hit is one part rather than three.
 */
export function scriptParts(script: string): ScriptPart[] {
    const parts: ScriptPart[] = [];
    let at = 0;
    for (const match of script.matchAll(PAD_HIT)) {
        const index = match.index;
        if (index > at) parts.push({ kind: 'text', text: script.slice(at, index) });
        parts.push({ kind: 'pad', name: match[1]!.toLowerCase() });
        at = index + match[0].length;
    }
    if (at < script.length) parts.push({ kind: 'text', text: script.slice(at) });
    return parts;
}

/**
 * A written break, with each soundboard hit drawn where it lands as the token the pads page shows.
 *
 * The token rather than the pad's label, because the label needs the rack and the token is what
 * the script actually says: an operator reading a break and then the pads page sees one spelling.
 */
export function PadScript({ script }: { script: string }) {
    return (
        <Text size="sm">
            {scriptParts(script).map((part, index) =>
                part.kind === 'text' ? (
                    <Fragment key={index}>{part.text}</Fragment>
                ) : (
                    <Badge
                        key={index}
                        variant="light"
                        color="grape"
                        size="sm"
                        // `tt: none` for the pads page's reason: a Badge upper-cases by default and
                        // the token is lower-case.
                        styles={{
                            root: { verticalAlign: 'middle' },
                            label: { fontFamily: 'var(--mantine-font-family-monospace)', textTransform: 'none' },
                        }}
                    >
                        {sfxToken(part.name)}
                    </Badge>
                ),
            )}
        </Text>
    );
}
