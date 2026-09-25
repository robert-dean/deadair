import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { SdkError } from '@deadair/sdk';

import { LanguagesCard } from '../../../src/components/settings/languages.card';
import { saveDownload } from '../../../src/components/shared/download';
import { availableLanguages, removeLanguage } from '../../../src/i18n/languages';
import packageJson from '../../../package.json';
import { germanPack } from '../../utils/language.pack.fixture';
import { render, screen, setupUser, waitFor, within } from '../../utils/render';

vi.mock('../../../src/components/shared/download', () => ({ saveDownload: vi.fn() }));

const listConsoleLanguages = vi.fn();
const getConsoleLanguage = vi.fn();
const importConsoleLanguage = vi.fn();
const removeConsoleLanguage = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        languages: {
            listConsoleLanguages: (...args: unknown[]) => listConsoleLanguages(...args),
            getConsoleLanguage: (...args: unknown[]) => getConsoleLanguage(...args),
            importConsoleLanguage: (...args: unknown[]) => importConsoleLanguage(...args),
            removeConsoleLanguage: (...args: unknown[]) => removeConsoleLanguage(...args),
        },
    },
}));

const GERMAN = { locale: 'de', name: 'Deutsch', direction: 'ltr', madeFor: '0.30.0', importedAt: DateTime.fromISO('2026-09-20T10:00:00Z') };

beforeEach(() => {
    listConsoleLanguages.mockResolvedValue({ languages: [] });
});

afterEach(async () => {
    vi.mocked(saveDownload).mockReset();
    listConsoleLanguages.mockReset();
    getConsoleLanguage.mockReset();
    importConsoleLanguage.mockReset();
    removeConsoleLanguage.mockReset();
    await removeLanguage('de');
});

/** Hands the import dialog a file, the way a person choosing one does. */
async function chooseFile(contents: string, name = 'deadair-console-de.json') {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await setupUser().upload(input, new File([contents], name, { type: 'application/json' }));
}

describe('LanguagesCard', () => {
    it('says which console version its English is from', () => {
        render(<LanguagesCard />);
        expect(screen.getByText(`Built in, as of console ${packageJson.version}`)).toBeInTheDocument();
    });

    it('exports the English as a language pack', async () => {
        render(<LanguagesCard />);
        await setupUser().click(screen.getByRole('button', { name: 'Export as a language pack' }));

        const [text, filename, type] = vi.mocked(saveDownload).mock.calls[0]!;
        expect(filename).toBe('deadair-console-en.json');
        expect(type).toBe('application/json');
        const pack = JSON.parse(text as string);
        expect(pack).toMatchObject({ format: 'deadair.console-language', locale: 'en', madeFor: packageJson.version });
        expect(pack.catalog.common.action.cancel).toBe('Cancel');
    });

    it('lists an imported language with how much of this console it covers', async () => {
        listConsoleLanguages.mockResolvedValue({ languages: [GERMAN] });
        getConsoleLanguage.mockResolvedValue(germanPack());
        render(<LanguagesCard />);

        expect(await screen.findByText('Deutsch')).toBeInTheDocument();
        expect(screen.getByText(/made for console 0\.30\.0/)).toBeInTheDocument();
        expect(await screen.findByText('0% translated')).toBeInTheDocument();
    });

    it('removes a language after asking', async () => {
        listConsoleLanguages.mockResolvedValue({ languages: [GERMAN] });
        getConsoleLanguage.mockResolvedValue(germanPack());
        removeConsoleLanguage.mockResolvedValue({ languages: [] });
        const user = setupUser();
        render(<LanguagesCard />);

        await user.click(await screen.findByRole('button', { name: 'Remove' }));
        const dialog = screen.getByRole('dialog', { name: 'Remove Deutsch?' });
        await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

        await waitFor(() => expect(removeConsoleLanguage).toHaveBeenCalledWith('de'));
        await waitFor(() => expect(screen.queryByText('Deutsch')).not.toBeInTheDocument());
    });
});

describe('importing a language pack', () => {
    it('previews what this console makes of it, then installs it here and on the station', async () => {
        importConsoleLanguage.mockResolvedValue({ languages: [GERMAN] });
        const user = setupUser();
        render(<LanguagesCard />);

        await user.click(screen.getByRole('button', { name: 'Import a language pack' }));
        await chooseFile(JSON.stringify({ ...germanPack(), extra: 'a translator tool added this' }));

        expect(await screen.findByText(/strings are translated/)).toBeInTheDocument();
        expect(importConsoleLanguage).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Install Deutsch' }));

        await waitFor(() => expect(importConsoleLanguage).toHaveBeenCalledTimes(1));
        const [locale, body] = importConsoleLanguage.mock.calls[0]!;
        expect(locale).toBe('de');
        // The pack's own fields only: the API refuses a key it does not know.
        expect(body).toEqual(germanPack());
        await waitFor(() => expect(availableLanguages().map(language => language.locale)).toContain('de'));
    });

    it('names the strings it will leave out, and why', async () => {
        const user = setupUser();
        render(<LanguagesCard />);

        await user.click(screen.getByRole('button', { name: 'Import a language pack' }));
        await chooseFile(JSON.stringify(germanPack({ catalog: { common: { notify: { saved: 'Gespeichert.' } } } })));

        expect(await screen.findByText('1 string was left out and shows in English:')).toBeInTheDocument();
        expect(screen.getByText('common.notify.saved (its placeholders differ from the English)')).toBeInTheDocument();
    });

    it('refuses a file that is not a pack, before anything is sent', async () => {
        const user = setupUser();
        render(<LanguagesCard />);

        await user.click(screen.getByRole('button', { name: 'Import a language pack' }));
        await chooseFile('{"hello":"world"}', 'notes.json');

        expect(await screen.findByText('notes.json is not a console language pack.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Install' })).toBeDisabled();
    });

    it('says so when the station refuses somebody who is not an admin', async () => {
        importConsoleLanguage.mockRejectedValue(new SdkError(403, 'Forbidden', { statusCode: 403, message: 'Forbidden' }, new Headers()));
        const user = setupUser();
        render(<LanguagesCard />);

        await user.click(screen.getByRole('button', { name: 'Import a language pack' }));
        await chooseFile(JSON.stringify(germanPack()));
        await user.click(await screen.findByRole('button', { name: 'Install Deutsch' }));

        expect(await screen.findByText('The language was not installed')).toBeInTheDocument();
        expect(screen.getByText('Only an admin can install a language. Nothing was changed.')).toBeInTheDocument();
        expect(availableLanguages().map(language => language.locale)).not.toContain('de');
    });
});
