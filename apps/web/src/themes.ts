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
 * Neon Transmitter: a night-city HUD. Neon yellow on teal-black, lit cyan and magenta.
 *
 * The loudest of the three and the only one where a panel does something other than have an edge —
 * `--da-glow-panel` in `tokens.css` is `none` everywhere else and the Card default names it
 * unconditionally, so this theme switches the glow on by redefining one variable.
 *
 * ## The accent is yellow and the glow is not
 *
 * The bloom around a card stays cyan and magenta while `phosphor` is yellow, which looks like an
 * oversight and is the entire design: the bloom is the CITY and the yellow is the INSTRUMENT. A card
 * that glowed in the accent would collapse the two, and the console would lose the only signal it
 * has for "this is the thing you selected" — every `--da-phosphor` site is exactly that, from the
 * nav's active bar to the chosen swatch on this page.
 *
 * Cyan still has a job in the palette rather than only in the glow: it is `blue`, which is standby.
 * That is where a theme's second colour belongs here — as a status somebody already reads — instead
 * of as a ninth tuple nothing resolves through.
 *
 * ## Why `yellow` is not yellow
 *
 * This is the one hex on the page that will be re-derived by whoever reads it next, so: `phosphor`
 * is `primaryColor` and `consoleTheme` aliases it to `teal` and `green`, which makes the accent the
 * console's "this one is good". `status.ts` then maps `fault` and `severityColor.warning` to
 * `yellow`. A theme with a yellow accent and a yellow warning draws "running" and "broken" in the
 * same colour, which is precisely the failure that file exists to close off.
 *
 * So the two warm status ramps rotate to make room. `yellow` becomes an amber-orange and `orange`
 * a red-orange, which keeps the half-step the running order depends on — `skipped` in `yellow`
 * because the station did its job, `unavailable` in `orange` because an operator can go and fix it
 * — and puts roughly twenty degrees between the accent and the nearest thing that means trouble.
 * If those two ever read alike on a real page, the fix is to move THESE anchors further apart. The
 * accent does not move: it is what makes this console the one it is.
 *
 * `grape` is magenta here rather than violet, which is the one place this theme changes what a hue
 * MEANS rather than what it looks like — and it does not: grape marks a thing the station authored,
 * and magenta says "not the accent, and not a fault" just as violet does against green. It is kept
 * at the pink end rather than pushed toward red, because the running order draws an authored break
 * and the tally on the same rows.
 */
const neon = consoleTheme(
    {
        // The iconic one, re-indexed so it lands on 4 where `primaryShade` and every `.4` call site
        // expect the anchor.
        phosphor: ['#ffffe6', '#fdffb0', '#fbff74', '#f9fa3c', '#fcee0a', '#e4d200', '#c4b400', '#a08f00', '#867a00', '#575000'],
        // 7 is the body, 6 a card or an input, 5 and 4 borders, 0 text — the positional contract
        // carbon's own surfaces ramp is ordered to. These five must agree with the `--da-*` surfaces
        // in `tokens.css`; a ramp that disagrees is the bug `theme.ts` describes, in slow motion.
        dark: ['#eafcff', '#c9e3ea', '#a3b0b4', '#7d8b90', '#333c41', '#20282c', '#0d1316', '#060a0c', '#040709', '#020405'],
        gray: ['#eafcff', '#c9e3ea', '#a3c2cc', '#8fa8b0', '#7d8b90', '#6a777c', '#556065', '#333c41', '#20282c', '#141c20'],
        red: ['#ffe6ea', '#ffc2cc', '#ff7d95', '#ff4f6e', '#ff1e46', '#f00038', '#e00030', '#b30026', '#87001d', '#6d0018'],
        // Cyan: standby, and the theme's second colour doing a job rather than sitting in a shadow.
        blue: ['#d6fbff', '#a3f5ff', '#66edff', '#2ee6ff', '#05deff', '#00c9f5', '#00a6cc', '#007e9c', '#005a70', '#003a49'],
        // Amber-orange rather than amber, for the reason above: the accent owns yellow here.
        yellow: ['#fff3e0', '#ffe0b3', '#ffc880', '#ffab47', '#ff8f00', '#e88100', '#cc7100', '#a85c00', '#804600', '#573000'],
        grape: ['#ffe6fa', '#ffc2f2', '#ff9ceb', '#ff5cdd', '#ff1fd0', '#e800b8', '#c4009c', '#9e007e', '#780060', '#520042'],
        // Pushed the same distance again, so the half-step below `yellow` survives the rotation.
        orange: ['#ffeae0', '#ffcdb8', '#ffa480', '#ff7847', '#ff4d00', '#e84500', '#c43a00', '#9e2f00', '#782400', '#521800'],
    },
    {
        body: 'Archivo, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
        // Two weights, 400 and 700, and nothing between — see the note beside the import in
        // `main.tsx`. A timecode is a timecode, but this one is stamped rather than printed.
        mono: '"Space Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        // The same angular face carbon sets its headings in, and it is not a duplication: what a
        // display face means here is decided by what sits UNDER it. Chakra Petch over Plex Sans is a
        // silkscreened label on a panel; Chakra Petch over Archivo, in capitals, at this tracking,
        // is a readout projected onto glass. The body pair is what tells the two consoles apart in
        // the Appearance swatch, which is why this theme's `typeLabel` names it second.
        display: '"Chakra Petch", Archivo, ui-sans-serif, system-ui, sans-serif',
        // Hard edges on ink, and deliberately not softened to match the rest of the theme's move:
        // a rounder neon than carbon would invert the console's own geometry, where the desk is the
        // forgiving surface and this one is not.
        radius: '2px',
    },
    {
        // The only console that stencils. Every legend on a heads-up display is set this way and
        // the tracking is what stops capitals at heading size closing up into a block.
        titleTransform: 'uppercase',
        titleTracking: '0.03em',
        buttonTransform: 'uppercase',
        buttonTracking: '0.08em',
        /**
         * Depth as bloom rather than as lift.
         *
         * The other two consoles keep Mantine's scale, where a Menu or a Modal casts a shadow to say
         * it is above the page. Nothing on a city street does that: a sign floats because it is
         * emitting, so the same five rungs are light instead of dark. Cyan close in and magenta
         * further out is the same two-colour reading as the backdrop and the panel glow, so a
         * dropdown looks like it belongs to the room it opened in.
         *
         * `xs` stays black. It is a hairline under a Tooltip and a bloom at that radius is a smear.
         */
        shadows: {
            xs: '0 1px 2px rgb(0 0 0 / 60%)',
            sm: '0 0 12px rgb(5 222 255 / 24%)',
            md: '0 0 22px rgb(5 222 255 / 28%)',
            lg: '0 0 40px rgb(255 31 208 / 26%)',
            xl: '0 0 64px rgb(255 31 208 / 32%)',
        },
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
 * `ConsoleSignage` is the one exception and it is a narrow one: the case and tracking of a heading
 * and of a button, and a shadow scale. Those went into the seam because without them a theme could
 * only ever be the same console tinted — the difference between a desk and a heads-up display is
 * whether the legends are stencilled, not which hues they are stencilled in. The boundary is that
 * signage is how a label is SET, while the conventions above are how the page is BUILT. A gradient,
 * a radius scale or an input variant would be the second kind and are deliberately absent.
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
        blurb: 'Neon yellow on teal-black, lit cyan and magenta. Loudest of the three.',
        typeLabel: 'Chakra Petch / Archivo',
        displayFont: '"Chakra Petch", sans-serif',
        swatches: ['#060a0c', '#141c20', '#fcee0a', '#ff1e46'],
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
