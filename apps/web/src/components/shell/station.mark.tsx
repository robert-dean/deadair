import { Image } from '@mantine/core';

export interface StationMarkProps {
    /** Rendered edge length in pixels. The asset is 192px, so anything up to 96 stays crisp at 2x. */
    size?: number;
}

/**
 * The station's mark.
 *
 * The artwork ships recoloured onto the console's own palette — phosphor line work, carbon-white
 * skull, no field behind it — rather than as the ochre badge it was drawn as. That is why it is a
 * transparent PNG and why nothing here clips it to a circle: it sits ON the desk surface rather
 * than on a disc of its own, so the header's scanlines run behind it unbroken.
 *
 * Decorative: the wordmark beside it carries the name, so this is hidden from assistive technology
 * rather than announcing "deadair" a second time.
 */
export function StationMark({ size = 30 }: StationMarkProps) {
    return <Image src="/logo-mark.png" alt="" aria-hidden w={size} h={size} style={{ flexShrink: 0 }} />;
}
