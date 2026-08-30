import { createTheme, type CSSVariablesResolver, type MantineColorsTuple, type MantineThemeOverride } from '@mantine/core';

/**
 * The two rungs added below `xs`, told to TypeScript.
 *
 * Mantine's spacing key is `... | (string & {})`, so `gap="xxs"` compiles with or without this and
 * the augmentation buys exactly one thing: the new rungs appear in autocomplete beside `xs` and
 * `sm`. That is the whole point — the reason the console had five different sub-gutter gaps is
 * that the scale offered nothing there and each author had to invent, so a rung nobody can find is
 * a rung that will be re-invented.
 */
declare module '@mantine/core' {
    export interface MantineThemeSizesOverride {
        spacing: Record<'xxxs' | 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl', string>;
    }
}

/**
 * The console's design language: a broadcast desk.
 *
 * Dark, dense and utilitarian, on the assumption that an operator reads this page while something
 * is going out live. Two rules run through everything below. Colour is SEMANTIC before it is
 * decorative — the tally conventions in `components/shared/status.ts` are the reason the built-in
 * palettes are retuned rather than replaced, so a `color="red"` written anywhere still means "on
 * air, or broken" and picks the new hue up for free. And density is a FEATURE: the spacing and
 * component defaults here are tighter than Mantine's, because the alternative to a dense table is
 * a scroll, and a scroll during a fault is worse than small text.
 */

/**
 * Carbon: the neutral ramp, lightest first, with a faint green cast so the accent sits in the
 * same light as the panels rather than on top of them.
 *
 * This replaces Mantine's `gray`, which is what `c="dimmed"`, every default border and every
 * `color="gray"` badge resolve through — so the whole console moves onto it with no call-site
 * edits. Index 4 is the anchor that `stoodDown` reads as "off": deliberately legible rather than
 * faint, because standing the station down is a decision an operator made and should be able to
 * see they made.
 */
const carbon: MantineColorsTuple = ['#E8EDEA', '#D2DAD6', '#A7B2AC', '#8B968F', '#77837D', '#6E7A74', '#57625C', '#3E4744', '#242927', '#161A18'];

/**
 * The same carbon, arranged the way Mantine's dark scheme reads a palette.
 *
 * This tuple is not decoration and overriding it is not optional: in dark mode Mantine draws
 * every surface from `dark` rather than from `gray`, so a console that overrode only `gray` came
 * out with carbon text on Mantine's stock grey cards. The indices are positional contracts —
 * 7 is the body, 6 is a card or an input, 5 and 4 are borders, 0 is text — which is why this ramp
 * is ordered to those meanings rather than as an even gradient.
 */
const carbonSurfaces: MantineColorsTuple = [
    '#E8EDEA',
    '#C4CDC8',
    '#A7B2AC',
    '#77837D',
    '#313836',
    '#242927',
    '#121514',
    '#0C0E0D',
    '#090B0A',
    '#050706',
];

/**
 * Phosphor: the accent, anchored at index 4 (`#2FD98C`) to match `primaryShade`.
 *
 * A screen-phosphor green, which is the one accent that reads as "instrument" rather than
 * "brand", and which the tally red has to fight for attention against — that contest is the point.
 */
const phosphor: MantineColorsTuple = ['#E3FBF1', '#C8F5E2', '#93EBC7', '#5CE2AB', '#2FD98C', '#21C57C', '#14B36D', '#0B9459', '#067544', '#02502D'];

/** Tally red: on air, and the hard failures. Loud on carbon on purpose. */
const tally: MantineColorsTuple = ['#FFECEC', '#FFD3D3', '#FFA8A8', '#FF7A7A', '#FF4B4B', '#F03333', '#DB2222', '#B51A1A', '#8E1414', '#660D0D'];

/** Standby blue: waiting on a listener, and anything found but not yet started. */
const standby: MantineColorsTuple = ['#E7F2FF', '#CBE3FF', '#9DC9FF', '#78B5FF', '#58A6FF', '#3D8FF0', '#2A7BDB', '#1F63B5', '#164A8A', '#0E3260'];

/** Fault amber: installed but wrong, stalled, or unreachable. Never used for "off". */
const fault: MantineColorsTuple = ['#FFF6E5', '#FFE9C2', '#FFD68A', '#FFC452', '#FFB224', '#F09C0C', '#DB8A00', '#B57200', '#8A5700', '#603D00'];

/**
 * The two hues that are not statuses, retuned so they belong to the same console.
 *
 * `grape` marks a thing the STATION authored — a break, a talk-over, a model's work — which is a
 * kind rather than a state, and giving it a status colour would make a perfectly healthy segment
 * read as a condition. `orange` is the one deliberate half-step in the status set: the running
 * order draws `skipped` in amber and `unavailable` in orange because a skip is the station doing
 * its job and an unavailable record is one an operator can go and fix.
 */
const authored: MantineColorsTuple = ['#F4EDFF', '#E5D8FF', '#CBB2FF', '#B08CFF', '#9A72F5', '#8459E0', '#7047C4', '#5A379E', '#432878', '#2D1A52'];
const alarm: MantineColorsTuple = ['#FFEFE5', '#FFDAC2', '#FFB98A', '#FF9C57', '#FF8330', '#F06A14', '#DB5A05', '#B54800', '#8A3700', '#602600'];

/**
 * The eight palettes a console needs, whichever console it is.
 *
 * A theme supplies exactly these. `phosphor` is the accent, and `teal` and `green` are aliased to it
 * by `consoleTheme` rather than being asked for again — anything reaching for a plain green means
 * "this one is good", and there is one of those on any desk.
 */
export interface ConsolePalettes {
    phosphor: MantineColorsTuple;
    /** The surfaces Mantine's dark scheme draws from. Still required by a light theme: see below. */
    dark: MantineColorsTuple;
    gray: MantineColorsTuple;
    red: MantineColorsTuple;
    blue: MantineColorsTuple;
    yellow: MantineColorsTuple;
    grape: MantineColorsTuple;
    orange: MantineColorsTuple;
}

/** The half of a theme that is not colour: the type it is set in, and how hard its corners are. */
export interface ConsoleFaces {
    /** The body face, as a full CSS stack. */
    body: string;
    mono: string;
    /** The display face, over the body one. */
    display: string;
    /** `sm` in the radius scale, which `defaultRadius` points at and every Card and control uses. */
    radius: string;
}

/**
 * How a theme SETS a label, as opposed to which face it sets it in.
 *
 * This is the one place the "a theme may not change the component conventions" rule bends, and it
 * bends for a measured reason: the difference between a desk and a heads-up display is not the
 * hues, it is whether the legends are stencilled. A theme that could only swap colours and faces
 * came out as the same console tinted, which is exactly the failure this console's own docs warn
 * about from the other direction.
 *
 * So the bend is bounded. Every field here is set by all three themes, so a difference between them
 * is a decision somebody wrote down rather than one theme quietly opting out — and the list stops
 * at signage. It does not carry `defaultGradient`, a radius SCALE or an input variant, because
 * those are how the same console becomes three design languages.
 */
export interface ConsoleSignage {
    /** Headings: a stencilled HUD legend, or sentence case. */
    titleTransform: 'uppercase' | 'none';
    titleTracking: string;
    /** The same claim at control size. */
    buttonTransform: 'uppercase' | 'none';
    buttonTracking: string;
    /**
     * What a floating surface does when it floats.
     *
     * Omitted means Mantine's own scale — a drop shadow, reading as lift. Only a console that
     * replaces depth with BLOOM sets this, and there is exactly one of those, so restating five
     * near-identical drop shadows in the other two themes would be noise rather than intent.
     */
    shadows?: MantineThemeOverride['shadows'];
}

/**
 * One console, in a given palette and a given face.
 *
 * Everything a theme does NOT get to choose is here: the spacing scale, the type scale, the
 * component conventions. Those are not stylistic — they are the density argument this file makes
 * further down, and a theme that could move them would be a second design language rather than the
 * same console in another light.
 */
export function consoleTheme(colors: ConsolePalettes, faces: ConsoleFaces, signage: ConsoleSignage): MantineThemeOverride {
    return createTheme({
        primaryColor: 'phosphor',
        primaryShade: 4,
        defaultRadius: 'sm',
        // Spread rather than assigned, because `shadows: undefined` and an absent `shadows` are not
        // the same thing to `createTheme`: the first replaces the scale with nothing.
        ...(signage.shadows ? { shadows: signage.shadows } : {}),
        // Filled surfaces pick their own text colour from what they are filled WITH, rather than
        // always taking white.
        //
        // This is not a preference. A `filled` Badge is how the nav says a page has something
        // waiting, and `severityColor.warning` is `yellow` — so on carbon that was white on #ffb224,
        // about 2:1, and on Neon it is white on an acid #f2ff26, about 1.1:1, which is a number
        // rather than a colour. Three themes each anchoring their own palette at index 4 is exactly
        // the situation where a hardcoded foreground stops being true, so it is computed.
        autoContrast: true,
        // Mantine's own scale except for `sm`, which `defaultRadius` points at and every Card,
        // control and skeleton therefore uses. That one rung is the difference between a desk with
        // rounded panels and a paper console ruled in straight lines, and it is the only geometry a
        // theme is allowed to move.
        radius: { xs: '2px', sm: faces.radius, md: '8px', lg: '16px', xl: '32px' },
        colors: {
            // The four built-ins the status vocabulary is expressed in are overridden rather than
            // added beside, so every `color="red"` already in the tree means the retuned red.
            ...colors,
            // `active` reads as phosphor: a plugin that is running is the same "good" as the accent,
            // and two greens a shade apart would look like a mistake rather than a distinction.
            teal: colors.phosphor,
            // For the same reason: anything reaching for a plain `green` means "this one is good",
            // and there is one of those on this desk.
            green: colors.phosphor,
        },
        fontFamily: faces.body,
        fontFamilyMonospace: faces.mono,
        headings: {
            fontFamily: faces.display,
            fontWeight: '600',
            sizes: {
                h1: { fontSize: '1.875rem', lineHeight: '1.2' },
                h2: { fontSize: '1.5rem', lineHeight: '1.25' },
                h3: { fontSize: '1.25rem', lineHeight: '1.3' },
                h4: { fontSize: '1.0625rem', lineHeight: '1.35' },
            },
        },
        /**
         * Type is Mantine's own scale, deliberately.
         *
         * It was a step smaller across the board for one pass, on the theory that an operator console
         * wants density. That is true and this was the wrong lever: shrinking the type AND the spacing
         * together is a uniform scale-down, which is the definition of zooming out, and it bought rows
         * that were harder to read rather than more rows worth reading. Density belongs in the places
         * below — table rows, card padding, the gutters — where it costs whitespace instead of
         * legibility.
         */
        /**
         * The scale, with two rungs below Mantine's own.
         *
         * `xs` at 8px is a card gutter, and the console needs something under it constantly: 56 call
         * sites reached below this scale and invented five different answers (2, 4, 5, 6 and 7px) for
         * what "tighter than a gutter" means. Reading them back, they were asking for two things and
         * drifting about one of them. The 4/5/6/7 cluster is the drift — forty-two sites spread across
         * three pixels, no two of which anybody could tell apart — and it collapses to `xxs`. The 2px
         * sites are not drift and are not the same idea: every one of them is a `Stack` pairing a line
         * with its own dimmed second line, where the gap is leading relief rather than separation, and
         * at that size doubling it to 4px visibly breaks the pair into two rows. So `xxxs` exists,
         * ugly name and all, because the alternative is sixteen call sites going back to naming a
         * number.
         */
        spacing: {
            xxxs: '2px',
            xxs: '4px',
            xs: '8px',
            sm: '12px',
            md: '16px',
            lg: '22px',
            xl: '30px',
        },
        components: {
            // The conventions live here rather than in wrapper components: a `Card` is a Mantine Card
            // everywhere, and the 26 call sites that used to each name their own padding and radius
            // now say nothing at all. A page that deviates is making a deliberate claim.
            Card: {
                defaultProps: { withBorder: true, padding: 'md', radius: 'sm' },
                // The one thing a panel does beyond having an edge, and on two of the three consoles it
                // does nothing at all: `--da-glow-panel` is `none` in `tokens.css` and only Neon
                // overrides it. Named unconditionally here rather than switched per theme, because a
                // convention that half the themes remember to set is a convention that drifts.
                styles: { root: { boxShadow: 'var(--da-glow-panel)' } },
            },
            Paper: {
                defaultProps: { radius: 'sm' },
            },
            Table: {
                defaultProps: { verticalSpacing: 6, horizontalSpacing: 'sm', highlightOnHover: true },
            },
            Skeleton: {
                defaultProps: { radius: 'sm' },
            },
            Tooltip: {
                defaultProps: { radius: 'sm', withinPortal: true },
            },
            Title: {
                // A heading is either a title or a legend stencilled on a panel, and which one it is
                // belongs to the theme rather than to the page — every `Title` in the console would
                // otherwise have to agree by hand, which is how the console ended up with three
                // letter-spacings for one uppercase label before `Eyebrow` existed.
                styles: { root: { textTransform: signage.titleTransform, letterSpacing: signage.titleTracking } },
            },
            Button: {
                styles: { root: { textTransform: signage.buttonTransform, letterSpacing: signage.buttonTracking } },
            },
            Badge: {
                // Uppercase is the desk's voice for a state, and tracking is what keeps it readable
                // at badge size. Both come from Mantine's own Badge styles, and neither is in
                // `ConsoleSignage` beside the Button pair above deliberately: all three consoles
                // want a state stencilled, so a knob whose three values would be identical is a
                // knob that exists only to drift.
                defaultProps: { radius: 'sm' },
            },
            Notification: {
                // The same spine as the Alert below, for the same reason and so that the two read as
                // one console: a toast is an alert that goes away by itself, and drawing it as a tinted
                // block would make the transient one louder than the one an operator has to act on.
                // `--notification-color` is Mantine's own variable for the colour that was asked for.
                styles: {
                    root: {
                        background: 'var(--da-raised)',
                        borderLeft: '2px solid var(--notification-color)',
                    },
                },
            },
            Alert: {
                // A panel with a coloured spine rather than a coloured block. Mantine's light variant
                // tints the whole background, which on a page that can show three alerts at once (a
                // silence cause, a refill failure, a stale container) turns most of the console into
                // warning. The spine says the same thing in 2px and leaves the text on the same
                // surface as everything else, which is what keeps a busy page readable.
                styles: {
                    root: {
                        background: 'var(--da-panel)',
                        borderLeft: '2px solid var(--alert-color)',
                    },
                },
            },
        },
    });
}

/** The console as this file has always drawn it: phosphor green on carbon, in Chakra Petch. */
export const theme = consoleTheme(
    { phosphor, dark: carbonSurfaces, gray: carbon, red: tally, blue: standby, yellow: fault, grape: authored, orange: alarm },
    {
        body: '"IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
        mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        // Squared and technical, like a silkscreened panel label. The contrast against Plex Sans
        // below it is what makes a heading read as a legend on equipment rather than a title.
        display: '"Chakra Petch", "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
        radius: '4px',
    },
    {
        // A heading here is a title, not a legend: Chakra Petch is already squared enough that
        // stencilling it as well would make a page of cards read as a warning label.
        titleTransform: 'none',
        titleTracking: 'normal',
        buttonTransform: 'none',
        buttonTracking: 'normal',
    },
);

/**
 * A theme's surfaces, published as Mantine's own variables.
 *
 * Done here rather than as a stylesheet override so that `withBorder`, `c="dimmed"` and every
 * component that reads `--mantine-color-body` land on the same values without a single call site
 * knowing about it.
 *
 * Both groups are filled, and every value in both is the same `--da-*` name. That looks redundant
 * and is the point: `[data-da-theme]` in `tokens.css` is what makes those names mean different
 * hexes, so one resolver serves every theme and the branch that runs is decided by that theme's
 * `scheme` rather than by anything written here. Mantine emits only the branch matching the forced
 * scheme, so the unused half costs nothing.
 */
export const cssVariablesResolver: CSSVariablesResolver = () => {
    const surfaces = {
        '--mantine-color-body': 'var(--da-bg)',
        '--mantine-color-default': 'var(--da-panel)',
        '--mantine-color-default-hover': 'var(--da-raised)',
        '--mantine-color-default-border': 'var(--da-border)',
        '--mantine-color-dimmed': 'var(--da-text-dimmed)',
        '--mantine-color-text': 'var(--da-text)',
        '--mantine-color-placeholder': 'var(--da-text-dimmed)',
    };
    return { variables: {}, light: surfaces, dark: surfaces };
};
