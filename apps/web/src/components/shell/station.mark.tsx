import { Image } from '@mantine/core';

export interface StationMarkProps {
    /** Rendered edge length in pixels. The asset is 192px, so anything up to 96 stays crisp at 2x. */
    size?: number;
}

/**
 * The station's mark.
 *
 * The DRAWING is untouched from the original badge; only the field behind it is the console's,
 * swapped from ochre to phosphor. That split matters because the artwork is black ink on a light
 * ground: keyed out and dropped straight onto the desk it lost its headphones and its arched type
 * to the dark, which read as a cropped skull rather than a logo. Giving the ink its ground back,
 * in the accent colour, is the only version where the mark is both the one that was drawn and
 * legible at 30px.
 *
 * The header uses the skull alone: at this size the arched "deadair radio" is illegible, and the
 * wordmark next to it already says the name. `/logo.png` is the full lockup for anywhere with room.
 *
 * `/logo-mark.png` and `/favicon.png` are BUILT from that lockup rather than cropped out of it. The
 * first attempt was a crop, and a crop tight enough to drop the arched type also ran the headphones
 * off the disc: both earcups were sliced flat by the circle's edge, which at 30px reads as a broken
 * image rather than a badge. They are now the skull group lifted off the lockup, the type painted
 * back out in the field colour, and the whole thing scaled so its farthest point sits at 84% of the
 * disc's radius. Regenerate them the same way — the ring of green is what makes it a mark.
 *
 * Decorative, so it is hidden from assistive technology rather than announcing the name twice.
 */
export function StationMark({ size = 30 }: StationMarkProps) {
    return <Image src="/logo-mark.png" alt="" aria-hidden w={size} h={size} style={{ flexShrink: 0 }} />;
}
