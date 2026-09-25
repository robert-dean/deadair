import { afterEach, describe, expect, it, vi } from 'vitest';

import { startConsoleLanguage } from '../../src/api/languages.queries';
import { i18n } from '../../src/i18n/i18n.setup';
import { removeLanguage, showLanguage } from '../../src/i18n/languages';
import { germanPack } from '../utils/language.pack.fixture';

const listConsoleLanguages = vi.fn();
const getConsoleLanguage = vi.fn();

vi.mock('../../src/api/client', () => ({
    sdk: {
        languages: {
            listConsoleLanguages: (...args: unknown[]) => listConsoleLanguages(...args),
            getConsoleLanguage: (...args: unknown[]) => getConsoleLanguage(...args),
        },
    },
}));

afterEach(async () => {
    listConsoleLanguages.mockReset();
    getConsoleLanguage.mockReset();
    localStorage.clear();
    vi.unstubAllGlobals();
    await showLanguage('en');
    await removeLanguage('de');
});

describe('startConsoleLanguage', () => {
    it('shows the language chosen on this browser, loading its pack from the station', async () => {
        listConsoleLanguages.mockResolvedValue({ languages: [{ locale: 'de', name: 'Deutsch', direction: 'ltr', madeFor: '' }] });
        getConsoleLanguage.mockResolvedValue(germanPack());
        localStorage.setItem('deadair.consoleLanguage', 'de');

        await startConsoleLanguage();
        expect(i18n.resolvedLanguage).toBe('de');
        expect(i18n.t('action.cancel')).toBe('Abbrechen');
    });

    it('follows the browser when nothing was chosen here', async () => {
        vi.stubGlobal('navigator', { ...navigator, languages: ['de-DE', 'en'] });
        listConsoleLanguages.mockResolvedValue({ languages: [{ locale: 'de', name: 'Deutsch', direction: 'ltr', madeFor: '' }] });
        getConsoleLanguage.mockResolvedValue(germanPack());

        await startConsoleLanguage();
        expect(i18n.resolvedLanguage).toBe('de');
    });

    it('stays in English when the station cannot be reached', async () => {
        listConsoleLanguages.mockRejectedValue(new TypeError('fetch failed'));
        localStorage.setItem('deadair.consoleLanguage', 'de');

        await startConsoleLanguage();
        expect(i18n.resolvedLanguage).toBe('en');
        expect(getConsoleLanguage).not.toHaveBeenCalled();
    });
});
