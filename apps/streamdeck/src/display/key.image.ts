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

/** The colour a vote key's heart takes when the station holds that opinion. */
const VOTE_COLOURS = { liked: '#2FD98C', disliked: '#FF4B4B' } as const;

/** The mark's own ink, and the edge an unlit heart needs instead of it. */
const INK = '#101413';
const UNLIT_HEART = '#1A201E';
const UNLIT_EDGE = '#4E5955';

/**
 * The heart, drawn where the badge has its disc.
 *
 * `logo-mark.png` is a bone skull on a field of phosphor green. These keys are that with the field
 * cut to a heart: the same drawing, the same green, a different shape under it. Which is why the
 * skull here is the mark's OWN artwork rather than a traced one — `tools/make-skull.py` lifts it off
 * the green and the plugin reads the result off its own folder, as it already reads the mark.
 */
const HEART = 'M72 124 C40 100 24 80 24 58 C24 40 37 28 52 28 C62 28 69 34 72 42 C75 34 82 28 92 28 C107 28 120 40 120 58 C120 80 104 100 72 124 Z';

/**
 * How the heart is placed, and where the skull sits in it.
 *
 * The path's own bounding box is centred on (72, 76) and it is scaled ABOUT that point, so the box
 * stays centred there whatever {@link HEART_SCALE} is. Its centre of AREA is (72, 68.3), about eight
 * units higher, because a heart tapers to a point at the bottom and carries its mass in the lobes —
 * measured by rasterising the path and taking the centroid.
 *
 * {@link SKULL_Y} is NEITHER of them, and that is worth saying plainly rather than dressing up. Both
 * were tried at both sizes the skull has had. The area centre leaves too much heart below the jaw
 * once the skull is small enough to clear the lobes; the box centre sits the skull low against the
 * taper. The number here was chosen by looking at the drawing rather than by computing anything, so
 * it does NOT follow {@link HEART_SCALE} the way a derived one would: change the scale and this wants
 * looking at again.
 */
const HEART_SCALE = 1.26;
const SKULL_Y = 73;
/**
 * Wide enough to be the mark and no wider. At 68 the headphones crowd the heart's sides and the jaw
 * runs into its taper; 56 clears the lobes with air around it and still reads at the 72 pixels a
 * Stream Deck actually shows. The skull's own canvas is square and the drawing in it is wider than
 * it is tall, so the height this takes up is less than the number says.
 */
const SKULL_WIDTH = 56;

/** The ban a dislike carries: the bar alone, because a heart this large leaves the key no room for a ring. */
const BAN = `<rect x="61" y="-10" width="22" height="164" rx="6" fill="${INK}" transform="rotate(45 72 72)"/>`;

/** What a Like or Dislike key draws. */
export interface VoteFace {
    vote: keyof typeof VOTE_COLOURS;
    /** The station's opinion of the record on air is this key's own. */
    lit: boolean;
    /** Nothing here is about the record on air: no station, a stale reading, or nothing to rate. */
    dim: boolean;
    /**
     * The mark's skull on transparency, as a data URI, drawn inside the heart. Absent draws the heart
     * alone, which is only for a plugin that could not read `skull.png` off its own folder — the same
     * forgiveness `mark` has on the Now Playing key.
     */
    skull?: string;
}

/**
 * A vote key as an SVG: the mark's skull on a heart, and the ban over it that a dislike is.
 *
 * Drawn by the renderer rather than as flat glyphs in the plugin folder, for the reason the Now
 * Playing key is: the keys of one plugin should look like each other, and a hand-drawn SVG beside a
 * rendered one drifts from it the first time either changes. The manifest's own two pictures are
 * written from THIS function by `tools/default.key.mjs`, so a key does not change face the moment the
 * plugin first draws.
 *
 * **One drawing, not two.** Like and Dislike are the same heart with the same skull in it, and the
 * dislike adds the ban across it. A torn heart was the other way to say it and was two shapes that
 * had to be kept fitting each other by hand; this is one shape with something laid over it. The ban
 * also says what the station means, which is not a shrug: a dislike is an instruction, and
 * `candidates.repository.ts` drops a disliked record from the draw outright.
 *
 * **The HEART carries the state, not the ground.** It fills with the vote's colour when the station
 * agrees and sits dark and grey-edged when it does not, which keeps the colour inside a shape instead
 * of flooding the key — a flooded red dislike beside the transport's red Stop is two red keys meaning
 * different things. The edge is ink on a lit heart and grey on an unlit one, because ink on carbon is
 * invisible and the heart disappears, leaving the skull floating.
 *
 * `dim` is not the same as unlit, and that is the distinction two flat state images could not draw:
 * unlit is the station having no such opinion, dim is the key having nothing to have an opinion
 * ABOUT. A dim key never takes its colour, whichever way it was lit, by the rule the whole plugin
 * follows — nothing may look live on a reading that is not.
 */
export function voteSvg(face: VoteFace): string {
    const lit = face.lit && !face.dim;
    const heart =
        `<g transform="translate(72 76) scale(${HEART_SCALE}) translate(-72 -76)">` +
        `<path d="${HEART}" fill="${lit ? VOTE_COLOURS[face.vote] : UNLIT_HEART}" stroke="${lit ? INK : UNLIT_EDGE}" stroke-width="9" stroke-linejoin="round"/>` +
        `</g>`;
    // `xlink:href` rather than the bare `href`, for the reason the cover uses it: the app's renderer
    // is Qt's and SVG 1.1 is the spelling it is sure to know.
    const skull =
        face.skull === undefined
            ? ''
            : `<image x="${72 - SKULL_WIDTH / 2}" y="${SKULL_Y - SKULL_WIDTH / 2}" width="${SKULL_WIDTH}" height="${SKULL_WIDTH}" xlink:href="${face.skull}"/>`;
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
        `<rect width="${SIZE}" height="${SIZE}" fill="${CARBON}"/>` +
        `<g${face.dim ? ` opacity="${FAINT}"` : ''}>${heart}${skull}${face.vote === 'disliked' ? BAN : ''}</g>` +
        `</svg>`
    );
}

/** An SVG as `setImage` takes one, which is URI-encoded and not base64. */
export function svgDataUri(svg: string): string {
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
