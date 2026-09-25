import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson } from '../sdk-options.js';
import type { ConsoleLanguageList, ConsoleLanguagePack } from './types/languages.types.js';
import { reviveConsoleLanguageList } from './types/languages.types.js';

export class LanguagesClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List console languages
     * @description Every language this station holds a pack for, without the strings
     */
    async listConsoleLanguages(): Promise<ConsoleLanguageList> {
        const result = await this.fetch(`/console/languages`, { method: 'GET' });
        return reviveConsoleLanguageList(await parseJson<ConsoleLanguageList>(result));
    }

    /**
     * @name Get console language
     * @description One language's pack, strings and all, as it was imported
     */
    async getConsoleLanguage(locale: string): Promise<ConsoleLanguagePack> {
        const result = await this.fetch(`/console/languages/${encodeURIComponent(locale)}`, { method: 'GET' });
        return await parseJson<ConsoleLanguagePack>(result);
    }

    /**
     * @name Import console language
     * @description Installs a language pack, replacing any pack already installed for the language. The tag in the path must be the pack's own
     */
    async importConsoleLanguage(locale: string, body: ConsoleLanguagePack): Promise<ConsoleLanguageList> {
        const result = await this.fetch(`/console/languages/${encodeURIComponent(locale)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveConsoleLanguageList(await parseJson<ConsoleLanguageList>(result));
    }

    /**
     * @name Remove console language
     * @description Removes a language. Anybody who had chosen it sees English
     */
    async removeConsoleLanguage(locale: string): Promise<ConsoleLanguageList> {
        const result = await this.fetch(`/console/languages/${encodeURIComponent(locale)}`, { method: 'DELETE' });
        return reviveConsoleLanguageList(await parseJson<ConsoleLanguageList>(result));
    }
}
