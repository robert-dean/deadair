import { Container, Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { assertStorableCatalog, canonicalLocale, LANGUAGE_PACK_VERSION, requireLocale } from './console.language.pack.js';
import { ConsoleLanguageRepository } from './console.language.repository.js';
import type { ConsoleLanguageList, ConsoleLanguagePack } from './types/languages.types.js';

/**
 * The languages the console can be shown in beyond its built-in English, each one a language pack an
 * admin imported.
 *
 * The console's language and nothing else: `stream.language` is what the station broadcasts in, and
 * nothing here reads or writes it.
 *
 * The API stores a pack and hands it back. It refuses a file only over what it can judge without the
 * console: the header, the language tag, and a catalog that is not strings or is too big to be one.
 * Whether each string fits the English it translates is decided by the console that loads it,
 * against its own English, which is why a pack imported under one console version keeps working,
 * string by string, under the next.
 */
@Injectable()
export class ConsoleLanguagesService {
    constructor(
        private readonly languages: ConsoleLanguageRepository,
        // The container rather than `AuthorizationContext` itself: the two reads here are public, and
        // an anonymous request has no context to inject. Only `import` asks, and only an admin
        // reaches it.
        private readonly container: Container,
    ) {}

    async list(): Promise<ConsoleLanguageList> {
        return { languages: await this.languages.list() };
    }

    /** @throws 404 for a language this station holds no pack for. */
    async get(tag: string): Promise<ConsoleLanguagePack> {
        const pack = await this.languages.get(requireLocale(tag));
        if (pack === undefined) throw httpError(404).withDetails({ message: `this station has no ${tag} language pack` });

        return {
            format: 'deadair.console-language',
            version: LANGUAGE_PACK_VERSION,
            locale: pack.locale,
            name: pack.name,
            direction: pack.direction,
            madeFor: pack.madeFor,
            catalog: pack.catalog,
        };
    }

    /**
     * Installs a language pack, replacing any this station held for the language.
     *
     * @throws 400 for a pack in a newer format, for one whose language is not the one in the path or
     * is English, and for a catalog that is not one.
     */
    async import(tag: string, pack: ConsoleLanguagePack): Promise<ConsoleLanguageList> {
        const locale = requireLocale(tag);

        if (pack.version > LANGUAGE_PACK_VERSION) {
            throw httpError(400).withDetails({
                message: `this station reads language packs up to version ${LANGUAGE_PACK_VERSION}, and this one is version ${pack.version}`,
            });
        }
        if (canonicalLocale(pack.locale) !== locale) {
            throw httpError(400).withDetails({ message: `the pack is for "${pack.locale}", not "${tag}"` });
        }
        // English is built into the console and is what every other language falls back to, key by
        // key. A pack that replaced it would leave nothing to fall back to.
        if (new Intl.Locale(locale).language === 'en') {
            throw httpError(400).withDetails({ message: 'English is built into the console, so there is no English pack to import' });
        }
        assertStorableCatalog(pack.catalog);

        const actor = this.container.get(AuthorizationContext).actor;
        await this.languages.put({
            locale,
            name: pack.name.trim(),
            direction: pack.direction,
            madeFor: pack.madeFor.trim(),
            catalog: pack.catalog,
            ...(actor.kind === 'user' ? { importedBy: actor.actorId } : {}),
        });

        return this.list();
    }

    /** @throws 404 for a language this station holds no pack for. */
    async remove(tag: string): Promise<ConsoleLanguageList> {
        const removed = await this.languages.remove(requireLocale(tag));
        if (!removed) throw httpError(404).withDetails({ message: `this station has no ${tag} language pack` });
        return this.list();
    }
}
