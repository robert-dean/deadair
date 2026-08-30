import type { CSSVariablesResolver, MantineThemeOverride } from '@mantine/core';

import { consoleTheme, cssVariablesResolver, theme } from './theme';

/** The consoles this console can be. */
export type ThemeId = 'carbon' | 'white' | 'neon';

export interface ThemeDefinition {
    id: ThemeId;
    /** As the Appearance section names it. */
    name: string;
    /** One line on what it is for, in the same voice as the rest of the console. */
    blurb: string;
    /** The type pair, written out — shown in that theme's own display face. */
    typeLabel: string;
    /** The display face `typeLabel` is set in, so a theme can be recognised before it is chosen. */
    displayFont: string;
    /** Four bands for the swatch: desk, panel, accent, tally. */
    swatches: [string, string, string, string];
    /**
     * Which half of Mantine's variables this theme draws from.
     *
     * Not decoration: in dark mode Mantine builds every surface out of the `dark` tuple and in light
     * mode out of `gray` and white, and the two branches of `cssVariablesResolver` are different
     * sets of names. A theme on paper has to say so or it gets carbon's surfaces with paper's text.
     */
    scheme: 'light' | 'dark';
    mantine: MantineThemeOverride;
    resolver: CSSVariablesResolver;
}

/**
 * Studio White: daylight and paper.
 *
 * ## It is not carbon inverted
 *
 * Every hue here is DARKER than its carbon counterpart rather than lighter, because contrast on
 * paper runs the other way: a phosphor green that reads as an instrument on a black desk reads as
 * highlighter on a white one. That is why this is a whole palette rather than a colour scheme — the
 * five status hues carry meaning, and meaning that survives a background change is meaning that was
 * re-picked for it.
 *
 * The tally is the exception that proves it. It stays red, because it is the one colour in this
 * console that means the same thing in every room, and a paper theme that made it maroon would be a
 * theme with an opinion about the studio.
 *
 * ## Index 4 is still the anchor
 *
 * `primaryShade` is 4 and the console names `red.4`, `yellow.4` and `orange.4` directly, so each
 * ramp below puts the design's own hex at index 4 and works outwards. On paper that means indices
 * 0–3 are tints nothing much uses and 5–9 carry the weight, which is the mirror of carbon.
 */
const white = consoleTheme(
    {
        // Anchored at #0e7247, a printer's green: dark enough to sit on white under body text.
        phosphor: ['#e6f2ec', '#c3e0d3', '#8ec9b1', '#4ba084', '#0e7247', '#0c6440', '#0a5636', '#08472c', '#063823', '#042a1a'],
        // In a light scheme Mantine barely touches `dark`, but it still emits the variables and a
        // handful of components reach for them. A monotonic ink ramp is the honest answer.
        dark: ['#7d7469', '#56504a', '#3c3830', '#2b2822', '#221f1a', '#1c1a15', '#18160f', '#12100b', '#0c0b07', '#060503'],
        // Warm paper, lightest first. This is what `c="dimmed"`, every default border and every
        // `color="gray"` badge resolve through, exactly as carbon's ramp does.
        gray: ['#ffffff', '#fbf9f4', '#f4f1ea', '#efebe1', '#e9e3d7', '#ddd6c8', '#c3b9a5', '#a89d89', '#7d7469', '#56504a'],
        red: ['#fdecec', '#f9cfcf', '#f0a3a3', '#e06060', '#c81f22', '#b31b1e', '#a81618', '#93211f', '#7c1214', '#5e0d0f'],
        blue: ['#e8f0fc', '#dbe6f7', '#b3ccef', '#5f8fd9', '#1a5cba', '#1750a3', '#14488f', '#113c78', '#0e3160', '#0a2447'],
        // The one that had to move furthest. Carbon's amber is #ffb224 and is invisible on paper;
        // this is the same warning at printing-ink weight.
        yellow: ['#fdf3e0', '#f8e3ba', '#eecd88', '#c9970f', '#97640a', '#8c5c08', '#8a5b00', '#764c00', '#603e00', '#4a2f00'],
        grape: ['#f0eafc', '#ddcdf7', '#c1a6ef', '#8b5fdc', '#6537c9', '#5a30b4', '#4a279c', '#3d2081', '#301966', '#24124d'],
        orange: ['#fdeee6', '#f9d6c2', '#f0b18a', '#d17640', '#ad4c17', '#9c4414', '#8a3c12', '#74320f', '#5d280c', '#471e09'],
    },
    {
        body: '"Public Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
        // Plex Mono in every theme. A timecode is a timecode.
        mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        // A serif masthead over a grotesque, which is how a printed schedule reads. It does the same
        // job Chakra Petch does on carbon — separating a heading from its page — by the opposite
        // means, because a squared technical face on paper reads as a form to fill in.
        display: 'Newsreader, Georgia, "Times New Roman", serif',
        // Rules instead of fills: 2px is barely a corner, which is what stops a page of white cards
        // on a white desk reading as a pile of pills.
        radius: '2px',
    },
    {
        // A serif masthead set in capitals is a monument, not a schedule. This is the theme with the
        // strongest reason of the three to leave a heading alone.
        titleTransform: 'none',
        titleTracking: 'normal',
        buttonTransform: 'none',
        buttonTracking: 'normal',
    },
);

/**
 * Neon Transmitter: cyan, magenta and hard edges on ink.
 *
 * The loudest of the three and the only one where a panel does something other than have an edge —
 * `--da-glow-panel` in `tokens.css` is `none` everywhere else and the Card default names it
 * unconditionally, so this theme switches the glow on by redefining one variable.
 *
 * `grape` is magenta here rather than violet, which is the one place this theme changes what a hue
 * MEANS rather than what it looks like — and it does not: grape marks a thing the station authored,
 * and magenta against cyan says "not the accent, and not a fault" just as violet does against green.
 */
const neon = consoleTheme(
    {
        phosphor: ['#e0feff', '#b3fbff', '#8ffbff', '#4df5ff', '#00f0ff', '#00d4e2', '#00bcd4', '#0097ab', '#007283', '#004d59'],
        // 7 is the body, 6 a card or an input, 5 and 4 borders, 0 text — the positional contract
        // carbon's own surfaces ramp is ordered to.
        dark: ['#e8f9ff', '#c6dcea', '#9fb6d6', '#6b7ba6', '#392f7a', '#241f52', '#0a0a16', '#04040a', '#030308', '#010104'],
        gray: ['#e8f9ff', '#c6dcea', '#9fb6d6', '#8497bd', '#6b7ba6', '#5a6890', '#4e40a3', '#392f7a', '#241f52', '#17173a'],
        red: ['#ffe6ea', '#ffc2cc', '#ff7d95', '#ff4f6e', '#ff1e46', '#f00038', '#e00030', '#b30026', '#87001d', '#6d0018'],
        blue: ['#e6ecff', '#c2d0ff', '#9db8ff', '#6690ff', '#2f6bff', '#1f5af5', '#1a4de0', '#153eb3', '#102f87', '#0a1147'],
        // Acid rather than amber: a warning has to be visible against cyan, and orange alone is too
        // close to the alarm below it.
        yellow: ['#fdffe0', '#fbffb3', '#f9ff9c', '#f7ff66', '#f2ff26', '#e4f000', '#c8d400', '#a3ad00', '#7d8500', '#575c00'],
        grape: ['#ffe6fa', '#ffc2f2', '#ff9ceb', '#ff5cdd', '#ff1fd0', '#e800b8', '#c4009c', '#9e007e', '#780060', '#520042'],
        orange: ['#fff0e6', '#ffd9c2', '#ffb073', '#ff8a33', '#ff6a00', '#e55f00', '#c25000', '#9e4100', '#7a3200', '#552300'],
    },
    {
        body: '"Space Grotesk", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
        mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        display: 'Syne, "Space Grotesk", ui-sans-serif, system-ui, sans-serif',
        radius: '2px',
    },
    {
        titleTransform: 'none',
        titleTracking: 'normal',
        buttonTransform: 'none',
        buttonTracking: 'normal',
    },
);

/**
 * The console's themes, and the seam that lets one be swapped for another.
 *
 * ## Why a theme is a whole object rather than a set of hexes
 *
 * The obvious version of this is one palette with three colour schemes over it, and it does not
 * survive contact with `theme.ts`: the console's whole colour argument is that the status tuples
 * OVERRIDE Mantine's built-ins, so `color="red"` already means the tally red. A scheme switch that
 * only moved the surfaces would leave those five tuned hues on a background they were tuned against
 * the opposite of. Each theme therefore carries its own tuples, its own type, its own radius and its
 * own scheme, and switching is swapping the object `MantineProvider` is handed.
 *
 * The `--da-*` half lives in `tokens.css`, keyed on `[data-da-theme]`, because those are the
 * surfaces the resolver points AT and a variable cannot be swapped from JavaScript without
 * re-rendering everything that reads it. `theme.store.ts` writes the attribute; the stylesheet does
 * the rest. One resolver serves all three for exactly that reason.
 *
 * ## What a theme may not change
 *
 * The spacing scale, the type scale and the component conventions, all of which stay in
 * `consoleTheme`. Those are the density argument rather than a look, and a theme that could move
 * them would be a second design language rather than the same console in another light.
 *
 * ## Carbon is the default and is not special
 *
 * It is first in this record and it is what an install with no stored preference gets, which is the
 * only sense in which it is the default. Nothing else in the console knows its name.
 */
export const THEMES: Record<ThemeId, ThemeDefinition> = {
    carbon: {
        id: 'carbon',
        name: 'Carbon',
        blurb: 'The studio at night. Phosphor green on carbon.',
        typeLabel: 'Chakra Petch / IBM Plex',
        displayFont: '"Chakra Petch", sans-serif',
        swatches: ['#0c0e0d', '#191d1b', '#2fd98c', '#ff4b4b'],
        scheme: 'dark',
        mantine: theme,
        resolver: cssVariablesResolver,
    },
    white: {
        id: 'white',
        name: 'Studio White',
        blurb: 'Daylight and paper. Rules instead of fills.',
        typeLabel: 'Newsreader / Public Sans',
        displayFont: 'Newsreader, Georgia, serif',
        swatches: ['#f4f1ea', '#ddd6c8', '#0e7247', '#c81f22'],
        scheme: 'light',
        mantine: white,
        resolver: cssVariablesResolver,
    },
    neon: {
        id: 'neon',
        name: 'Neon Transmitter',
        blurb: 'Cyan, magenta and hard edges on ink. Loudest of the three.',
        typeLabel: 'Syne / Space Grotesk',
        displayFont: 'Syne, sans-serif',
        swatches: ['#04040a', '#12122a', '#00f0ff', '#ff1fd0'],
        scheme: 'dark',
        mantine: neon,
        resolver: cssVariablesResolver,
    },
};

/** The themes in the order the Appearance section offers them: the console's own look first. */
export const THEME_ORDER: ThemeId[] = ['carbon', 'white', 'neon'];

/** Whether a string off `localStorage` — or off anywhere else — names a theme this console has. */
export function isThemeId(value: unknown): value is ThemeId {
    return typeof value === 'string' && value in THEMES;
}

/**
 * What an install with nothing stored gets.
 *
 * Named rather than written as `'carbon'` at each site, because the reason the default is carbon is
 * that it is the console's own look — not that it happens to sort first.
 */
export const DEFAULT_THEME: ThemeId = 'carbon';
