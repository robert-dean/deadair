import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { Selectable } from 'kysely';
import { OAuthClientRepository, type OAuthClient } from '@maroonedsoftware/authentication';
import { DataRepository, type DeadairOauthClients } from '#src/modules/data/data.repository.js';

/** A client as the console lists it: the library's shape plus what only the station records. */
export interface StoredOAuthClient extends OAuthClient {
    createdAt: DateTime;
    lastUsedAt?: DateTime;
    createdBy?: string;
}

/**
 * The apps allowed to ask the station for a token: the ones an operator created, and the ones that
 * registered themselves. `OAuthClientRepository` for the library, plus what the console needs.
 *
 * A client that describes itself with a metadata document is never here; the library fetches and
 * caches it. A revoked client is invisible to the library, which then refuses it as unknown.
 */
@Injectable()
export class DeadairOAuthClientRepository extends DataRepository implements OAuthClientRepository {
    async findByClientId(clientId: string): Promise<OAuthClient | undefined> {
        const row = await this.db
            .selectFrom('deadair.oauthClients')
            .selectAll()
            .where('clientId', '=', clientId)
            .where('revokedAt', 'is', null)
            .executeTakeFirst();
        return row ? toClient(row) : undefined;
    }

    async create(client: OAuthClient): Promise<OAuthClient> {
        return toClient(await this.insert(client));
    }

    /** A client an operator created in the console, recorded against them. */
    async createPreregistered(client: OAuthClient, createdBy: string): Promise<StoredOAuthClient> {
        return toStored(await this.insert(client, createdBy));
    }

    async touchLastUsed(clientId: string, at: DateTime, extendTo?: DateTime): Promise<void> {
        await this.db
            .updateTable('deadair.oauthClients')
            .set({ lastUsedAt: at, ...(extendTo === undefined ? {} : { expiresAt: extendTo }) })
            .where('clientId', '=', clientId)
            .execute();
    }

    async deleteExpired(before: DateTime): Promise<number> {
        const result = await this.db.deleteFrom('deadair.oauthClients').where('expiresAt', '<', before).executeTakeFirst();
        return Number(result.numDeletedRows);
    }

    /** Every client that has not been revoked, newest first, for the console. */
    async listAll(): Promise<StoredOAuthClient[]> {
        const rows = await this.db
            .selectFrom('deadair.oauthClients')
            .selectAll()
            .where('revokedAt', 'is', null)
            .orderBy('createdAt', 'desc')
            .execute();
        return rows.map(toStored);
    }

    /** Withdraw a client. Answers whether there was one to withdraw. */
    async revoke(clientId: string): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.oauthClients')
            .set({ revokedAt: DateTime.utc() })
            .where('clientId', '=', clientId)
            .where('revokedAt', 'is', null)
            .executeTakeFirst();
        return Number(result.numUpdatedRows) > 0;
    }

    private async insert(client: OAuthClient, createdBy?: string): Promise<Selectable<DeadairOauthClients>> {
        if (client.kind === 'metadata_document') throw new Error('a client that describes itself is fetched, never stored');
        return await this.db
            .insertInto('deadair.oauthClients')
            .values({
                clientId: client.clientId,
                kind: client.kind,
                name: client.clientName,
                redirectUris: client.redirectUris,
                tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
                secretHash: client.secretHash,
                clientUri: client.clientUri,
                logoUri: client.logoUri,
                expiresAt: client.expiresAt,
                createdBy,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
    }
}

// A SQL NULL reads back as `undefined` whatever the generated type says, so every optional column
// is tested with `== null` and dropped rather than passed through (apps/api/CLAUDE.md).
function toClient(row: Selectable<DeadairOauthClients>): OAuthClient {
    return {
        clientId: row.clientId,
        kind: row.kind,
        redirectUris: row.redirectUris,
        tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
        ...(row.name == null ? {} : { clientName: row.name }),
        ...(row.secretHash == null ? {} : { secretHash: row.secretHash }),
        ...(row.clientUri == null ? {} : { clientUri: row.clientUri }),
        ...(row.logoUri == null ? {} : { logoUri: row.logoUri }),
        ...(row.expiresAt == null ? {} : { expiresAt: row.expiresAt }),
    };
}

function toStored(row: Selectable<DeadairOauthClients>): StoredOAuthClient {
    return {
        ...toClient(row),
        createdAt: row.createdAt,
        ...(row.lastUsedAt == null ? {} : { lastUsedAt: row.lastUsedAt }),
        ...(row.createdBy == null ? {} : { createdBy: row.createdBy }),
    };
}
