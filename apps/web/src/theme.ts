import { createTheme, type CSSVariablesResolver, type MantineColorsTuple } from '@mantine/core';

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
const carbonSurfaces: MantineColorsTuple = ['#E8EDEA', '#C4CDC8', '#A7B2AC', '#77837D', '#313836', '#242927', '#121514', '#0C0E0D', '#090B0A', '#050706'];

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

export const theme = createTheme({
    primaryColor: 'phosphor',
    primaryShade: 4,
    defaultRadius: 'sm',
    colors: {
        phosphor,
        // The four built-ins the status vocabulary is expressed in are overridden rather than
        // added beside, so every `color="red"` already in the tree means the retuned red.
        dark: carbonSurfaces,
        gray: carbon,
        red: tally,
        blue: standby,
        yellow: fault,
        // `active` reads as phosphor: a plugin that is running is the same "good" as the accent,
        // and two greens a shade apart would look like a mistake rather than a distinction.
        teal: phosphor,
        // For the same reason: anything reaching for a plain `green` means "this one is good", and
        // there is one of those on this desk.
        green: phosphor,
        grape: authored,
        orange: alarm,
    },
    fontFamily: '"IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    fontFamilyMonospace: '"IBM Plex Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    headings: {
        // Squared and technical, like a silkscreened panel label. The contrast against Plex Sans
        // below it is what makes a heading read as a legend on equipment rather than a title.
        fontFamily: '"Chakra Petch", "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
        fontWeight: '600',
        sizes: {
            h1: { fontSize: '1.625rem', lineHeight: '1.2' },
            h2: { fontSize: '1.25rem', lineHeight: '1.25' },
            h3: { fontSize: '1.0625rem', lineHeight: '1.3' },
            h4: { fontSize: '0.9375rem', lineHeight: '1.35' },
        },
    },
    fontSizes: {
        xs: '0.6875rem',
        sm: '0.78125rem',
        md: '0.875rem',
        lg: '1rem',
        xl: '1.125rem',
    },
    lineHeights: {
        xs: '1.35',
        sm: '1.4',
        md: '1.45',
        lg: '1.5',
        xl: '1.55',
    },
    spacing: {
        xs: '6px',
        sm: '10px',
        md: '14px',
        lg: '20px',
        xl: '28px',
    },
    components: {
        // The conventions live here rather than in wrapper components: a `Card` is a Mantine Card
        // everywhere, and the 26 call sites that used to each name their own padding and radius
        // now say nothing at all. A page that deviates is making a deliberate claim.
        Card: {
            defaultProps: { withBorder: true, padding: 'md', radius: 'sm' },
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
        Badge: {
            // Uppercase is the desk's voice for a state, and tracking is what keeps it readable
            // at badge size.
            defaultProps: { radius: 'sm' },
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

/**
 * The carbon surfaces, published as Mantine's own variables.
 *
 * Done here rather than as a stylesheet override so that `withBorder`, `c="dimmed"` and every
 * component that reads `--mantine-color-body` land on the same values without a single call site
 * knowing about it. Only the dark group is filled: the console is dark-only and says so in three
 * places (this file, `index.html`, and `forceColorScheme` in `main.tsx`).
 */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
    variables: {},
    light: {},
    dark: {
        '--mantine-color-body': 'var(--da-bg)',
        '--mantine-color-default': 'var(--da-panel)',
        '--mantine-color-default-hover': 'var(--da-raised)',
        '--mantine-color-default-border': 'var(--da-border)',
        '--mantine-color-dimmed': 'var(--da-text-dimmed)',
        '--mantine-color-text': 'var(--da-text)',
        '--mantine-color-placeholder': 'var(--da-text-dimmed)',
    },
});
