import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppearanceCard } from '../../../src/components/settings/appearance.card';
import { setTheme, THEME_STORAGE_KEY } from '../../../src/theme.store';
import { render, screen, setupUser } from '../../utils/render';

describe('AppearanceCard', () => {
    beforeEach(() => {
        window.localStorage.clear();
        setTheme('carbon');
    });

    afterEach(() => {
        // The store is module-level and the attribute is on the real document, so a case that
        // leaves either behind is a case that decides the next one.
        setTheme('carbon');
        window.localStorage.clear();
    });

    it('offers all three, with the console own look first', () => {
        render(<AppearanceCard />);

        const names = screen.getAllByRole('button').map(button => button.textContent ?? '');

        expect(names).toHaveLength(3);
        expect(names[0]).toContain('Carbon');
        expect(names[1]).toContain('Studio White');
        expect(names[2]).toContain('Neon Transmitter');
    });

    it('says which one is on', () => {
        render(<AppearanceCard />);

        expect(screen.getByRole('button', { name: /Carbon/ })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: /Studio White/ })).toHaveAttribute('aria-pressed', 'false');
    });

    /**
     * The attribute is what `tokens.css` keys every `--da-*` block on, so writing it IS applying the
     * theme. Written in the same tick as the state change rather than in an effect, because a frame
     * of the new theme's variables under the old theme's tuples reads as a flash of a third theme.
     */
    it('applies the choice to the document', async () => {
        render(<AppearanceCard />);
        await setupUser().click(screen.getByRole('button', { name: /Neon Transmitter/ }));

        expect(document.documentElement.getAttribute('data-da-theme')).toBe('neon');
        expect(screen.getByRole('button', { name: /Neon Transmitter/ })).toHaveAttribute('aria-pressed', 'true');
    });

    it('remembers it on this browser', async () => {
        render(<AppearanceCard />);
        await setupUser().click(screen.getByRole('button', { name: /Studio White/ }));

        expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('white');
    });
});
