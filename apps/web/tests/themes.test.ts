import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { THEME_ORDER } from '../src/themes';

/**
 * A WCAG audit measured four text/background pairs on Studio White below the 4.5:1 AA floor for
 * text under 18px — a disabled Button label, a SegmentedControl's inactive label, the nav rail's
 * hint letter and the station clock. All four read through one of two tokens,
 * `--da-text-dimmed` or `--da-text-secondary`, against one of two grounds, `--da-bg` or
 * `--da-panel` — so this file checks the tokens rather than the four call sites, which is the
 * level the fix landed at and the level a future palette change could break again without anyone
 * noticing until the next manual audit.
 *
 * `tokens.css` is not a module vitest can import, so its `--da-*` values are read back with
 * `fs.readFileSync` and parsed out of each theme's `:root[data-da-theme='…']` block (carbon's is
 * the bare `:root` block, since it is what an install with no stored preference gets).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_CSS_PATH = path.join(__dirname, '../src/tokens.css');
const tokensCss = fs.readFileSync(TOKENS_CSS_PATH, 'utf-8');

const TOKEN_NAMES = ['--da-bg', '--da-panel', '--da-text-dimmed', '--da-text-secondary'] as const;
type TokenName = (typeof TOKEN_NAMES)[number];

/** The carbon block is the unqualified `:root`; the other two are keyed on the theme attribute. */
function themeBlockSelector(themeId: string): RegExp {
    return themeId === 'carbon' ? /:root\s*\{([^}]*)\}/ : new RegExp(`:root\\[data-da-theme=['"]${themeId}['"]\\]\\s*\\{([^}]*)\\}`);
}

function readThemeTokens(themeId: string): Record<TokenName, string> {
    const match = tokensCss.match(themeBlockSelector(themeId));
    if (!match) {
        throw new Error(`tokens.css: no :root block found for theme '${themeId}'`);
    }
    const block = match[1];

    const tokens = {} as Record<TokenName, string>;
    for (const name of TOKEN_NAMES) {
        const tokenMatch = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
        if (!tokenMatch) {
            throw new Error(`tokens.css: theme '${themeId}' does not set ${name}`);
        }
        tokens[name] = tokenMatch[1];
    }
    return tokens;
}

/** WCAG 2.1 relative luminance of one sRGB channel, 0-255. */
function linearizeChannel(channel: number): number {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance of a `#rrggbb` colour. */
function relativeLuminance(hex: string): number {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 0.2126 * linearizeChannel(r) + 0.7152 * linearizeChannel(g) + 0.0722 * linearizeChannel(b);
}

/** WCAG 2.1 contrast ratio between two `#rrggbb` colours, always >= 1. */
function contrastRatio(a: string, b: string): number {
    const lA = relativeLuminance(a);
    const lB = relativeLuminance(b);
    const lighter = Math.max(lA, lB);
    const darker = Math.min(lA, lB);
    return (lighter + 0.05) / (darker + 0.05);
}

const AA_TEXT_CONTRAST = 4.5;

describe('theme tokens: WCAG AA text contrast', () => {
    describe.each(THEME_ORDER)('%s', themeId => {
        const tokens = readThemeTokens(themeId);

        // `--da-text-dimmed` and `--da-text-secondary` are the two tokens every under-18px dimmed
        // or secondary label in the console reads through (the nav rail's hint letter, the station
        // clock, a disabled Button label, a SegmentedControl's inactive label), so both have to
        // clear AA against whichever of the two grounds they might sit on — a panel-on-panel card
        // is common enough that "passes on the desk but not on a card" is still a real failure.
        it.each(['--da-text-dimmed', '--da-text-secondary'] as const)('%s clears 4.5:1 against --da-bg and --da-panel', tokenName => {
            const textColor = tokens[tokenName];
            const ratioAgainstBg = contrastRatio(textColor, tokens['--da-bg']);
            const ratioAgainstPanel = contrastRatio(textColor, tokens['--da-panel']);

            expect(
                ratioAgainstBg,
                `${themeId}'s ${tokenName} (${textColor}) measures ${ratioAgainstBg.toFixed(2)}:1 against --da-bg (${tokens['--da-bg']}), under the 4.5:1 AA floor`,
            ).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
            expect(
                ratioAgainstPanel,
                `${themeId}'s ${tokenName} (${textColor}) measures ${ratioAgainstPanel.toFixed(2)}:1 against --da-panel (${tokens['--da-panel']}), under the 4.5:1 AA floor`,
            ).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
        });
    });
});
