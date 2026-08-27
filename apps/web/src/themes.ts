import type { CSSVariablesResolver, MantineThemeOverride } from '@mantine/core';

import { cssVariablesResolver, theme } from './theme';

/** The consoles this console can be. */
export type ThemeId = 'carbon';

export interface ThemeDefinition {
    id: ThemeId;
    /** As the Appearance section names it. */
    name: string;
    /** One line on what it is for, in the same voice as the rest of the console. */
    blurb: string;
    /** The type pair, written out — shown in that theme's own display face. */
    typeLabel: string;
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
 * The console's themes, and the seam that lets one be swapped for another.
 *
 * ## Why a theme is a whole object rather than a set of hexes
 *
 * The obvious version of this is one palette with three colour schemes over it, and it does not
 * survive contact with `theme.ts`: the console's whole colour argument is that the status tuples
 * OVERRIDE Mantine's built-ins, so `color="red"` already means the tally red. A scheme switch that
 * only moved the surfaces would leave those five tuned hues on a background they were tuned against
 * the opposite of. Each theme therefore carries its own tuples, its own type, its own radius scale
 * and its own resolver, and switching is swapping the object `MantineProvider` is handed.
 *
 * The `--da-*` half lives in `tokens.css`, keyed on `[data-da-theme]`, because those are the
 * surfaces the resolvers point AT and a variable cannot be swapped from JavaScript without
 * re-rendering everything that reads it. `theme.store.ts` writes the attribute; the stylesheet does
 * the rest.
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
        swatches: ['#0c0e0d', '#191d1b', '#2fd98c', '#ff4b4b'],
        scheme: 'dark',
        mantine: theme,
        resolver: cssVariablesResolver,
    },
};

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
