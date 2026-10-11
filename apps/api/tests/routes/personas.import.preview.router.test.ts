// The one route an operator's phrasings are judged through before they reach the station: the import
// preview, through the generated router and the real planner, with only the reads stubbed.
//
// What it pins is the vocabulary check as seen from outside. The placeholder vocabulary is a plain
// object, so for as long as membership was asked with `in`, every name on Object.prototype counted as
// one the station could fill: a file whose phrasing named `{{toString}}` or `{{constructor}}` previewed
// clean, imported, and then aired "[object Object]" or threw out of the renderer.

import type { Server } from 'node:http';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import Koa from 'koa';
import { errorMiddleware, JsonParser, JsonParserOptions, ServerKitBodyParser, ServerKitParserMappings } from '@maroonedsoftware/koa';
import { PolicyService } from '@maroonedsoftware/policies';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PersonasRouter } from '../../src/routes/personas.router.js';
import { PersonaImportService } from '../../src/modules/personas/persona.import.service.js';
import { PERSONA_FILE_FORMAT } from '../../src/modules/personas/persona.file.js';
import type { PersonaRepository } from '../../src/modules/personas/persona.repository.js';
import type { PersonasService } from '../../src/modules/personas/personas.service.js';
import type { PersonaStoriesRepository } from '../../src/modules/personas/persona.stories.repository.js';
import type { SpeechService } from '../../src/modules/render/speech.service.js';
import type { PadSetRepository } from '../../src/modules/render/pad.set.repository.js';
import type { Logger } from '@maroonedsoftware/logger';
import type { PersonaImportPlan } from '../../src/modules/personas/types/personas.types.js';

// Explicitly, for the reason `render.router.test.ts` gives at length: `listen(0)` on the wildcard can
// share a port with something bound to loopback specifically.
const LOOPBACK = '127.0.0.1';

let server: Server | undefined;

afterEach(async () => {
    await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
});

const post = (url: string, body: unknown): Promise<{ status: number; body: string }> =>
    new Promise((resolve, reject) => {
        const text = JSON.stringify(body);
        const req = request(
            url,
            { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) } },
            response => {
                const chunks: Buffer[] = [];
                response.on('data', chunk => chunks.push(chunk as Buffer));
                response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
            },
        );
        req.on('error', reject);
        req.end(text);
    });

/**
 * The real import service over a station that holds nothing: no characters, no speech engine, no
 * soundboards. Every notice a preview can raise then comes from the file alone.
 */
const serve = async (): Promise<string> => {
    const service = new PersonaImportService(
        { list: async () => [] } as unknown as PersonaRepository,
        {} as PersonasService,
        { list: async () => [] } as unknown as PersonaStoriesRepository,
        { speaker: () => undefined } as unknown as SpeechService,
        { list: async () => [] } as unknown as PadSetRepository,
        { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger,
    );

    const mappings = new ServerKitParserMappings();
    mappings.set('json', new JsonParser(new JsonParserOptions()));
    const bodyParser = new ServerKitBodyParser(mappings);
    // Satisfied rather than exercised: which policy the route carries is the contract's business.
    const policies = { assert: vi.fn(async () => undefined) };

    const app = new Koa();
    app.use(errorMiddleware() as unknown as Koa.Middleware);
    app.use(async (ctx, next) => {
        (ctx as unknown as { container: { get: (token: unknown) => unknown } }).container = {
            get: (token: unknown) => (token === PersonaImportService ? service : token === PolicyService ? policies : bodyParser),
        };
        (ctx as unknown as { authenticationSession: unknown }).authenticationSession = { actor: { id: 'test' } };
        await next();
    });
    app.use(PersonasRouter.routes() as unknown as Koa.Middleware);

    server = app.listen(0, LOOPBACK);
    await new Promise<void>(resolve => server!.once('listening', () => resolve()));

    return `http://${LOOPBACK}:${(server!.address() as AddressInfo).port}`;
};

const file = (templates: string) => ({
    format: PERSONA_FILE_FORMAT,
    takenAt: '2026-10-11T00:00:00.000Z',
    personas: [{ key: 'overnight', label: 'The overnight host', style: 'a voice for the small hours', templates, stories: [] }],
});

const phrasingNotices = (plan: PersonaImportPlan): string[] =>
    plan.personas.flatMap(entry => entry.notices.filter(notice => notice.kind === 'phrasing').map(notice => notice.message));

describe('POST /personas/import/preview', () => {
    it('reports a phrasing that names a property every object has, rather than passing it', async () => {
        const base = await serve();

        const response = await post(
            `${base}/personas/import/preview`,
            file('That was {{toString}}.\nAnd {{constructor}} there, from {{previous.artist}}.'),
        );

        expect(response.status).toBe(200);
        const notices = phrasingNotices(JSON.parse(response.body) as PersonaImportPlan);
        expect(notices).toHaveLength(2);
        expect(notices[0]).toContain('{{toString}}');
        expect(notices[1]).toContain('{{constructor}}');
    });

    it('raises nothing over a phrasing the station can fill', async () => {
        const base = await serve();

        const response = await post(`${base}/personas/import/preview`, file('That was {{previous.title}}, from {{previous.artist}}.'));

        expect(response.status).toBe(200);
        expect(phrasingNotices(JSON.parse(response.body) as PersonaImportPlan)).toEqual([]);
    });
});
