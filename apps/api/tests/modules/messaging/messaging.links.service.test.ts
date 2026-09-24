// The console's half of linking. What matters is who may: an API key may not hand a chat account its
// owner's powers, and one account cannot unlink another's chat account by guessing its id.

import { describe, expect, it, vi } from 'vitest';

import { MessagingLinksService } from '../../../src/modules/messaging/messaging.links.service.js';
import { AuthorizationContext } from '../../../src/modules/permissions/authorization.context.js';
import type { MessagingRepository } from '../../../src/modules/messaging/messaging.repository.js';
import { hashLinkCode } from '../../../src/modules/messaging/messaging.link.code.js';

const user = (apiKey = false) =>
    new AuthorizationContext({
        kind: 'user',
        sessionToken: 's',
        actorId: 'actor-1',
        platformRoles: new Set(['admin']),
        factors: [],
        ...(apiKey ? { apiKey: { id: 'k', name: 'script', grants: new Set(['view', 'manage'] as const) } } : {}),
    });

const repository = () =>
    ({
        saveLinkCode: vi.fn(async () => undefined),
        links: vi.fn(async () => []),
        unlink: vi.fn(async () => false),
    }) as unknown as MessagingRepository & { saveLinkCode: ReturnType<typeof vi.fn>; unlink: ReturnType<typeof vi.fn> };

describe('MessagingLinksService', () => {
    it('stores only the hash of the code it hands back', async () => {
        const repo = repository();
        const { code } = await new MessagingLinksService(user(), repo).createCode();

        expect(repo.saveLinkCode).toHaveBeenCalledWith('actor-1', hashLinkCode(code), expect.anything());
        expect(JSON.stringify(repo.saveLinkCode.mock.calls)).not.toContain(code);
    });

    it('refuses an API key, which must not hand a chat account its owner’s powers', async () => {
        await expect(new MessagingLinksService(user(true), repository()).createCode()).rejects.toMatchObject({ statusCode: 403 });
    });

    it('unlinks only the caller’s own link, and answers 404 for anybody else’s', async () => {
        const repo = repository();

        await expect(new MessagingLinksService(user(), repo).remove('deadair.telegram', '7')).rejects.toMatchObject({ statusCode: 404 });
        expect(repo.unlink).toHaveBeenCalledWith('deadair.telegram', '7', 'actor-1');
    });
});
