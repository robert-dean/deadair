import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { ConsoleLanguagesService } from '#src/modules/languages/console.languages.service.js';
import { ConsoleLanguageChoice, ConsoleLanguageList, ConsoleLanguagePack } from '../modules/languages/types/languages.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [languages.ck](../../data/contracts/languages/languages.ck)
 */
export const LanguagesRouter = ServerKitRouter();

/**
 * The language you chose for the console, if you chose one
 * from [languages.ck](../../data/contracts/languages/languages.ck#L19)
 */
LanguagesRouter.get('/console/language', requirePolicy({ policy: false }), async ctx => {
    const service = ctx.container.get(ConsoleLanguagesService);
    const result: ConsoleLanguageChoice = await service.choice();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Chooses the language your console is shown in, or, without one, goes back to following the browser
 * from [languages.ck](../../data/contracts/languages/languages.ck#L33)
 */
LanguagesRouter.put('/console/language', requirePolicy({ policy: false }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, ConsoleLanguageChoice);

    const service = ctx.container.get(ConsoleLanguagesService);
    const result: ConsoleLanguageChoice = await service.choose(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Every language this station holds a pack for, without the strings
 * from [languages.ck](../../data/contracts/languages/languages.ck#L54)
 * anonymous access, no security required
 */
LanguagesRouter.get('/console/languages', async ctx => {
    const service = ctx.container.get(ConsoleLanguagesService);
    const result: ConsoleLanguageList = await service.list();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * One language's pack, strings and all, as it was imported
 * from [languages.ck](../../data/contracts/languages/languages.ck#L72)
 * anonymous access, no security required
 */
LanguagesRouter.get('/console/languages/:locale', async ctx => {
    const { locale } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            locale: z.string().min(2).max(35),
        }),
    );

    const service = ctx.container.get(ConsoleLanguagesService);
    const result: ConsoleLanguagePack = await service.get(locale);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Installs a language pack, replacing any pack already installed for the language. The tag in the path must be the pack's own
 * from [languages.ck](../../data/contracts/languages/languages.ck#L83)
 */
LanguagesRouter.put('/console/languages/:locale', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { locale } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            locale: z.string().min(2).max(35),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, ConsoleLanguagePack);

    const service = ctx.container.get(ConsoleLanguagesService);
    const result: ConsoleLanguageList = await service.import(locale, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Removes a language. Anybody who had chosen it sees English
 * from [languages.ck](../../data/contracts/languages/languages.ck#L95)
 */
LanguagesRouter.delete('/console/languages/:locale', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { locale } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            locale: z.string().min(2).max(35),
        }),
    );

    const service = ctx.container.get(ConsoleLanguagesService);
    const result: ConsoleLanguageList = await service.remove(locale);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
