import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import dayjs from 'dayjs';

import { ConfirmModal } from '../../src/components/shared/confirm.modal';
import { i18n } from '../../src/i18n/i18n.setup';
import { availableLanguages, installLanguagePack, removeLanguage, showLanguage, useConsoleDirection } from '../../src/i18n/languages';
import { arabicPack, germanPack } from '../utils/language.pack.fixture';
import { render, screen } from '../utils/render';

afterEach(async () => {
    await removeLanguage('de');
    await removeLanguage('ar');
});

describe('installing a language pack', () => {
    it('makes the language available without showing it', () => {
        expect(installLanguagePack(germanPack()).ok).toBe(true);
        expect(availableLanguages().map(language => language.locale)).toEqual(['en', 'de']);
        expect(i18n.resolvedLanguage).toBe('en');
    });

    it('refuses a file that is not a pack, and installs nothing', () => {
        expect(installLanguagePack({ hello: 'world' })).toEqual({ ok: false, refusal: 'not-a-pack' });
        expect(availableLanguages()).toHaveLength(1);
    });

    it('shows its words, and English for whatever it has not translated', async () => {
        installLanguagePack(germanPack());
        await showLanguage('de');

        expect(i18n.t('action.cancel')).toBe('Abbrechen');
        expect(i18n.t('copy.copy')).toBe('Copy');
        expect(document.documentElement.lang).toBe('de');
        expect(document.documentElement.dir).toBe('ltr');
    });

    it('reaches a component on screen', async () => {
        installLanguagePack(germanPack());
        await showLanguage('de');
        render(
            <ConfirmModal opened onClose={() => {}} onConfirm={() => {}} title="?" confirmLabel="Go">
                body
            </ConfirmModal>,
        );
        expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument();
    });

    it('replaces a language wholesale when installed again', async () => {
        installLanguagePack(germanPack());
        installLanguagePack(germanPack({ catalog: { common: { action: { dismiss: 'Ausblenden' } } } }));
        await showLanguage('de');

        expect(i18n.t('action.dismiss')).toBe('Ausblenden');
        expect(i18n.t('action.cancel')).toBe('Cancel');
    });

    it('teaches the date pickers its month names from the browser', () => {
        installLanguagePack(germanPack());
        expect(dayjs('2026-01-15').locale('de').format('MMMM')).toBe('Januar');
    });

    it('turns the layout round for a language that runs right to left', async () => {
        installLanguagePack(arabicPack());
        const { result } = renderHook(() => useConsoleDirection());
        expect(result.current).toBe('ltr');

        await act(() => showLanguage('ar'));
        expect(result.current).toBe('rtl');
        expect(document.documentElement.dir).toBe('rtl');
    });

    it('goes back to English when the language on screen is removed', async () => {
        installLanguagePack(germanPack());
        await showLanguage('de');
        await removeLanguage('de');

        expect(i18n.resolvedLanguage).toBe('en');
        expect(i18n.t('action.cancel')).toBe('Cancel');
        expect(availableLanguages()).toHaveLength(1);
    });

    it('shows English when asked for a language it does not hold', async () => {
        await showLanguage('fr');
        expect(i18n.resolvedLanguage).toBe('en');
    });
});
