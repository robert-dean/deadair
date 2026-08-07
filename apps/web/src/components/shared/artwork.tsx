import { useState } from 'react';
import { Center, Image, Text } from '@mantine/core';

import { artSrc } from '../../api/art';

export interface ArtworkProps {
    /** An `imageUrl` or `artworkUrl` straight off an API row, in any of the spellings it arrives in. */
    src?: string;
    /** What the art is of. Doubles as the placeholder's initial, so pass the name, not "cover art". */
    alt: string;
    /** Square, in pixels. */
    size: number;
    radius?: string;
}

/** The first character of a name, counted in code points so an emoji or a surrogate pair survives. */
const initial = (alt: string): string => [...alt.trim()][0]?.toUpperCase() ?? '';

/**
 * A square of cover art, or a square where it would be.
 *
 * One component for every surface that shows art — the catalog pages and the transport alike —
 * because the interesting part is the absence: most of this catalog has no art at all until the
 * ingest and the enrichment walk have both been past, and each call site inventing its own empty
 * state would make a half-filled library look broken rather than unfinished. The placeholder is deliberately quiet — an initial, not an icon
 * and not a "no image" label, which would draw the eye to every gap in a list of fifty rows.
 *
 * A URL that fails to load falls back to the same placeholder. Art is hotlinked from the provider
 * until the cache pass has the bytes, so a dead upstream is an ordinary outcome and not worth a
 * broken-image glyph.
 *
 * `artSrc` resolves the station's own copy against the API base; see its own note on why the API
 * cannot mint that URL itself.
 */
export function Artwork({ src, alt, size, radius = 'sm' }: ArtworkProps) {
    const [failed, setFailed] = useState(false);
    const resolved = artSrc(src);

    if (resolved === undefined || failed) {
        return (
            <Center
                w={size}
                h={size}
                bd="1px solid var(--mantine-color-default-border)"
                bg="var(--mantine-color-default)"
                style={{ borderRadius: `var(--mantine-radius-${radius})`, flexShrink: 0 }}
                aria-hidden
            >
                <Text c="dimmed" fw={600} size={size >= 96 ? 'xl' : 'sm'}>
                    {initial(alt)}
                </Text>
            </Center>
        );
    }

    return (
        <Image
            src={resolved}
            alt={alt}
            w={size}
            h={size}
            radius={radius}
            fit="cover"
            style={{ flexShrink: 0 }}
            onError={() => {
                setFailed(true);
            }}
        />
    );
}
