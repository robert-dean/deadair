import type { Tone } from '../station/transport.reading.js';

/** The key's own coordinate space. Stream Deck scales it to 72 or 144 pixels, whichever the device has. */
const SIZE = 144;

/**
 * How finely the bar moves. Each step is a redraw, and a redraw carries the whole cover again, so this
 * is the trade between a bar that looks continuous and a plugin that sends a cover every second: 36
 * steps is a redraw every five to eight seconds on an ordinary record, and two pixels a step on a
 * 72-pixel key.
 */
export const PROGRESS_STEPS = 36;

/** The console's tally colours (`apps/web/src/theme.ts`), at the shade its lamps use. */
const TONE_COLOURS: Record<Tone, string> = {
    live: '#FF4B4B',
    standby: '#58A6FF',
    off: '#77837D',
    fault: '#FFB224',
};

const CARBON = '#0C0E0D';
const GROOVE = '#242927';
const STALE = '#57625C';

/** What the Now Playing key draws. */
export interface NowPlayingFace {
    /** The cover as a data URI. Absent draws the record placeholder. */
    cover?: string;
    /** How far through, in steps of {@link PROGRESS_STEPS}. Absent draws no bar, which is what an unmeasured record gets. */
    step?: number;
    tone: Tone;
    /** The reading is from before an attempt that failed, so nothing on the key may look live. */
    stale: boolean;
    /**
     * The dark shade along the bottom that the title is read against. `false` for a key showing no
     * title, where it would only darken the cover.
     */
    shade?: boolean;
    /**
     * The station's mark as a data URI, drawn where there is no cover: nothing on air, a break, a
     * cover that could not be had. Absent draws a plain record instead, which is only for a plugin
     * that could not read its own mark off disk.
     */
    mark?: string;
}

/** Which step a fraction of the way through falls on. */
export function progressStep(fraction: number, steps = PROGRESS_STEPS): number {
    return Math.min(steps, Math.max(0, Math.floor(fraction * steps)));
}

/**
 * The Now Playing key as an SVG: the cover, a shade under the title, and the bar along the top edge.
 *
 * The cover is EMBEDDED in the SVG and the app rasterises the lot, which is why the plugin needs no
 * image decoder: a native one cannot ship in a packed plugin and a JavaScript one is a megabyte to
 * produce the 72 pixels the app would scale to anyway. `xlink:href` rather than the bare `href`,
 * because an SVG renderer that is not a browser may know only the SVG 1.1 spelling.
 *
 * The bar is at the TOP because the app draws the title along the bottom, over the shade.
 */
export function nowPlayingSvg(face: NowPlayingFace): string {
    const colour = face.stale ? STALE : TONE_COLOURS[face.tone];
    const picture =
        face.cover !== undefined
            ? `<image x="0" y="0" width="${SIZE}" height="${SIZE}" preserveAspectRatio="xMidYMid slice" xlink:href="${face.cover}"${dimmed(face) ? ` opacity="${FAINT}"` : ''}/>`
            : face.mark !== undefined
              ? markImage(face.mark, dimmed(face))
              : placeholder(colour);
    const bar =
        face.step === undefined
            ? ''
            : `<rect width="${SIZE}" height="8" fill="#000000" fill-opacity="0.6"/>` +
              `<rect width="${(face.step / PROGRESS_STEPS) * SIZE}" height="8" fill="${colour}"/>`;
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
        `<defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.85"/>` +
        `</linearGradient></defs>` +
        `<rect width="${SIZE}" height="${SIZE}" fill="${CARBON}"/>` +
        picture +
        (face.shade === false ? '' : `<rect y="64" width="${SIZE}" height="80" fill="url(#shade)"/>`) +
        bar +
        `</svg>`
    );
}

/** How faint a picture is drawn when it is not the station as it is now. */
const FAINT = 0.4;

/**
 * Whether the picture is drawn faint. The record placeholder said how the station was in its label's
 * colour; the mark is the station's own colours and cannot, so it says it by weight instead: full
 * while the station is airing or ready for a listener, faint when it was stood down, is failing, or
 * the reading is old. The words under it say which.
 *
 * A cover follows the same rule. A station that stops answering leaves the last cover on the key,
 * because one missed reading must not blank it, and at full weight that cover would look current
 * for as long as the station is gone. Faint, it reads as the last thing known.
 */
function dimmed(face: NowPlayingFace): boolean {
    return face.stale || face.tone === 'off' || face.tone === 'fault';
}

/** The station's mark, where the record placeholder's disc was, above the title. */
function markImage(mark: string, dim: boolean): string {
    return `<image x="26" y="14" width="92" height="92" xlink:href="${mark}"${dim ? ` opacity="${FAINT}"` : ''}/>`;
}

/** A record, its label in the station's tone: the fallback for a plugin with no mark to draw. */
function placeholder(colour: string): string {
    return (
        `<circle cx="72" cy="60" r="38" fill="#161A18" stroke="#3E4744" stroke-width="2"/>` +
        `<circle cx="72" cy="60" r="27" fill="none" stroke="${GROOVE}" stroke-width="2"/>` +
        `<circle cx="72" cy="60" r="12" fill="${colour}"/>` +
        `<circle cx="72" cy="60" r="3" fill="${CARBON}"/>`
    );
}

/** An SVG as `setImage` takes one, which is URI-encoded and not base64. */
export function svgDataUri(svg: string): string {
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
