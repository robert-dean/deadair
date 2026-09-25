import { DateTime } from 'luxon';
import { describe, expect, it, vi } from 'vitest';
import type { Container } from 'injectkit';

import { AuthorizationContext } from '../../../src/modules/permissions/authorization.context.js';
import { ConsoleLanguagesService } from '../../../src/modules/languages/console.languages.service.js';
import type { ConsoleLanguageRepository, LanguageDraft, StoredLanguagePack } from '../../../src/modules/languages/console.language.repository.js';
import type { ConsoleLanguagePack } from '../../../src/modules/languages/types/languages.types.js';

const IMPORTED = DateTime.fromISO('2026-09-25T12:00:00Z');

function germanPack(overrides: Partial<ConsoleLanguagePack> = {}): ConsoleLanguagePack {
    return {
        format: 'deadair.console-language',
        version: 1,
        locale: 'de',
        name: 'Deutsch',
        direction: 'ltr',
        madeFor: '0.35.0',
        catalog: { common: { action: { cancel: 'Abbrechen' } } },
        ...overrides,
    };
}

/** An in-memory repository, and the service over it with an admin signed in. */
function service(actor: unknown = { kind: 'user', actorId: 'admin-1' }) {
    const rows = new Map<string, StoredLanguagePack>();
    const repository = {
        list: vi.fn(async () => [...rows.values()].map(({ catalog: _catalog, ...language }) => language)),
        get: vi.fn(async (locale: string) => rows.get(locale)),
        put: vi.fn(async (draft: LanguageDraft) => {
            rows.set(draft.locale, {
                locale: draft.locale,
                name: draft.name,
                direction: draft.direction,
                madeFor: draft.madeFor,
                catalog: draft.catalog,
                importedAt: IMPORTED,
            });
        }),
        remove: vi.fn(async (locale: string) => rows.delete(locale)),
    };
    const container = { get: vi.fn((token: unknown) => (token === AuthorizationContext ? { actor } : undefined)) };
    return {
        repository,
        container,
        languages: new ConsoleLanguagesService(repository as unknown as ConsoleLanguageRepository, container as unknown as Container),
    };
}

const status = async (promise: Promise<unknown>): Promise<number | undefined> =>
    promise.then(
        () => undefined,
        (error: { statusCode?: number }) => error.statusCode,
    );

describe('ConsoleLanguagesService', () => {
    it('installs a pack, saying who imported it, and lists it without its strings', async () => {
        const { languages, repository } = service();
        const list = await languages.import('de', germanPack());

        expect(repository.put).toHaveBeenCalledWith(expect.objectContaining({ locale: 'de', importedBy: 'admin-1' }));
        expect(list).toEqual({ languages: [{ locale: 'de', name: 'Deutsch', direction: 'ltr', madeFor: '0.35.0', importedAt: IMPORTED }] });
    });

    it('hands the pack back as the document it was', async () => {
        const { languages } = service();
        await languages.import('de', germanPack());

        expect(await languages.get('de')).toEqual(germanPack());
    });

    it('reads the language in the path in its canonical form', async () => {
        const { languages, repository } = service();
        await languages.import('pt-br', germanPack({ locale: 'pt-BR', name: 'Português' }));

        expect(repository.put).toHaveBeenCalledWith(expect.objectContaining({ locale: 'pt-BR' }));
        expect((await languages.get('PT-br')).locale).toBe('pt-BR');
    });

    it('answers 404 for a language it holds no pack for', async () => {
        const { languages } = service();
        expect(await status(languages.get('fr'))).toBe(404);
        expect(await status(languages.remove('fr'))).toBe(404);
    });

    it.each([
        ['a newer format', 'de', germanPack({ version: 2 })],
        ['a pack for another language than the path names', 'fr', germanPack()],
        ['English, which is built in', 'en-GB', germanPack({ locale: 'en-GB' })],
        ['a catalog that is not strings', 'de', germanPack({ catalog: { common: { action: { cancel: 1 } } } })],
    ])('refuses %s', async (_, tag, pack) => {
        const { languages, repository } = service();
        expect(await status(languages.import(tag, pack))).toBe(400);
        expect(repository.put).not.toHaveBeenCalled();
    });

    it('removes a language and answers what is left', async () => {
        const { languages } = service();
        await languages.import('de', germanPack());
        await languages.import('fr', germanPack({ locale: 'fr', name: 'Français' }));

        expect((await languages.remove('de')).languages.map(language => language.locale)).toEqual(['fr']);
    });

    it('never reads who is signed in to serve the public reads', async () => {
        const { languages, container } = service();
        await languages.list();
        expect(await status(languages.get('de'))).toBe(404);
        expect(container.get).not.toHaveBeenCalled();
    });
});
