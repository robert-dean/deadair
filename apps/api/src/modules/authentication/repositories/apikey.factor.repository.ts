import { Injectable } from 'injectkit';
import { Kysely } from 'kysely';
import { DateTime } from 'luxon';
import type { RelationTuple } from '@maroonedsoftware/permissions';
import { ApiKeyRepository, type ApiKey, type ApiKeyListOptions, type ApiKeyUpdatePatch, type TargetActor } from '@maroonedsoftware/authentication';
import { httpError } from '@maroonedsoftware/errors';
import { DataRepository, type DB } from '#src/modules/data/data.repository.js';
import { DeadairPermissionsTupleRepository } from '#modules/permissions/permissions.repository.js';
import { PLATFORM_NAMESPACE, PLATFORM_OBJECT_ID } from '#modules/permissions/platform.roles.js';
import { isApiKeyScope, parseApiKeyScopes, scopeRelation, type ApiKeyScope } from '../api.key.scopes.js';

/** The namespace a key is an object in, as `data/permissions/core.perm` declares it. */
export const APIKEY_NAMESPACE = 'apikey';

/** The one kind of owner a station key has. */
const OWNER_KIND = 'user';

type ApiKeyRow = {
    id: string;
    actorId: string;
    name: string;
    hint: string;
    secretHash: string;
    createdAt: DateTime;
    expiresAt: DateTime | null;
    revokedAt: DateTime | null;
};

const userSubject = (actorId: string) => ({ kind: 'concrete' as const, namespace: 'user', id: actorId });

/**
 * The tuples that make a key what it is in the permissions model: who owns it, the station it hangs
 * off (the parent `station->view` walks to), and one `scoped_*` relation per scope, written for the
 * owner. See the `apikey` namespace in `core.perm` for why each is there.
 */
const tuplesFor = (keyId: string, actorId: string, scopes: ReadonlyArray<ApiKeyScope>): RelationTuple[] => {
    const object = { namespace: APIKEY_NAMESPACE, id: keyId };
    return [
        { object, relation: 'owner', subject: userSubject(actorId) },
        { object, relation: 'station', subject: { kind: 'concrete', namespace: PLATFORM_NAMESPACE, id: PLATFORM_OBJECT_ID } },
        ...scopes.map(scope => ({ object, relation: scopeRelation(scope), subject: userSubject(actorId) })),
    ];
};

/** Only the scope words `core.perm` declares survive, so a stray string is not a way to write a tuple. */
const knownScopes = (scopes: ReadonlyArray<string>): ApiKeyScope[] => scopes.filter(isApiKeyScope);

/**
 * `ApiKeyRepository` over `deadair.actors_apikey_factors`, with the key's grant held in the tuple
 * store rather than in a column.
 *
 * **Registered transient, and that is load-bearing.** `authenticationMiddleware` resolves the bearer
 * chain, and with it `ApiKeyService` and this repository, BEFORE `audit.context.middleware` swaps the
 * request's `Kysely` for its transaction. A scoped instance would keep the pool handle for the rest
 * of the request, so a key created by a route would write its row and its tuples outside the
 * request's transaction, each committing on its own. Transient means the instance a route resolves is
 * built after the swap. The one read the authentication path makes (`findBySecretHash`) is a plain
 * read and is fine on the pool.
 *
 * A key's scopes are read back from the relations its owner holds on it, and `lastUsedAt` from
 * `login_events`, where a use is recorded with the caller's address (see
 * `authorization.context.middleware`). So {@link touchLastUsed} does nothing: ServerKit calls it from
 * inside `authenticationMiddleware`, where there is no address to record yet.
 */
@Injectable()
export class DeadairApiKeyRepository extends DataRepository implements ApiKeyRepository {
    constructor(
        db: Kysely<DB>,
        private readonly tuples: DeadairPermissionsTupleRepository,
    ) {
        super(db);
    }

    async create(key: ApiKey): Promise<ApiKey> {
        const actorId = this.requireUserOwner(key.owner);
        const scopes = knownScopes(key.scopes);

        const row = await this.db
            .insertInto('deadair.actorsApikeyFactors')
            .values({
                id: key.id,
                actorId,
                name: key.name,
                hint: key.hint,
                secretHash: key.secretHash,
                // `created_at` is left to the database rather than taken from `key.createdAt`. Its
                // default and `updated_at`'s are both `now()`, the START of the request's transaction,
                // while ServerKit stamped `createdAt` from this process's clock a moment later, so
                // passing it through fails `updated_at >= created_at` on every insert. The record
                // handed back is the row, so the key's creation time is the database's either way.
                expiresAt: key.expiresAt ?? null,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        await this.tuples.write(tuplesFor(row.id, actorId, scopes), actorId);

        return this.toModel(row, scopes);
    }

    async findById(id: string): Promise<ApiKey | undefined> {
        const row = await this.db.selectFrom('deadair.actorsApikeyFactors').selectAll().where('id', '=', id).executeTakeFirst();
        if (!row) return undefined;
        const [hydrated] = await this.hydrate([row]);
        return hydrated;
    }

    /**
     * The authentication hot path: one indexed read for the row, one for its scopes. `lastUsedAt` is
     * left off because nothing on this path reads it, and a third query per request would be paying
     * for a list column. Revoked and expired keys come back too, as the ServerKit contract asks, so
     * the service can tell a withdrawn key from one nobody issued.
     */
    async findBySecretHash(secretHash: string): Promise<ApiKey | undefined> {
        const row = await this.db.selectFrom('deadair.actorsApikeyFactors').selectAll().where('secretHash', '=', secretHash).executeTakeFirst();
        if (!row) return undefined;
        return this.toModel(row, await this.scopesOf(row.id, row.actorId));
    }

    async listByOwner(owner: TargetActor, options: ApiKeyListOptions = {}): Promise<ApiKey[]> {
        const actorId = this.requireUserOwner(owner);
        let query = this.db.selectFrom('deadair.actorsApikeyFactors').selectAll().where('actorId', '=', actorId);
        if (!options.includeInactive) {
            const now = DateTime.utc();
            query = query.where('revokedAt', 'is', null).where(eb => eb.or([eb('expiresAt', 'is', null), eb('expiresAt', '>', now)]));
        }
        const rows = await query.orderBy('createdAt', 'desc').execute();
        return this.hydrate(rows);
    }

    async update(id: string, patch: ApiKeyUpdatePatch): Promise<ApiKey> {
        const existing = await this.requireRow(id);

        const set: { name?: string; hint?: string; secretHash?: string; expiresAt?: DateTime | null } = {};
        if (patch.name !== undefined) set.name = patch.name;
        if (patch.hint !== undefined) set.hint = patch.hint;
        if (patch.secretHash !== undefined) set.secretHash = patch.secretHash;
        // The one `null` in the package: absent leaves the expiry alone, `null` clears it.
        if (patch.expiresAt !== undefined) set.expiresAt = patch.expiresAt;
        // `metadata` is ServerKit's and the station never sets it, so there is no column for it.

        if (Object.keys(set).length > 0) {
            await this.db.updateTable('deadair.actorsApikeyFactors').set(set).where('id', '=', id).execute();
        }

        if (patch.scopes !== undefined) {
            const held = await this.scopesOf(id, existing.actorId);
            const wanted = knownScopes(patch.scopes);
            const object = { namespace: APIKEY_NAMESPACE, id };
            await this.tuples.delete(
                held
                    .filter(scope => !wanted.includes(scope))
                    .map(scope => ({ object, relation: scopeRelation(scope), subject: userSubject(existing.actorId) })),
            );
            await this.tuples.write(
                wanted
                    .filter(scope => !held.includes(scope))
                    .map(scope => ({ object, relation: scopeRelation(scope), subject: userSubject(existing.actorId) })),
                existing.actorId,
            );
        }

        return this.requireKey(id);
    }

    /**
     * Withdraw a key. The first revocation's time is kept, as the ServerKit contract asks. The tuples
     * stay, so the account's list can still say what a withdrawn key was allowed to do; a revoked key
     * never validates, so they grant nothing.
     */
    async revoke(id: string, at: DateTime): Promise<ApiKey> {
        await this.db
            .updateTable('deadair.actorsApikeyFactors')
            .set(eb => ({ revokedAt: eb.fn.coalesce('revokedAt', eb.val(at)) }))
            .where('id', '=', id)
            .execute();
        return this.requireKey(id);
    }

    async revokeAllForOwner(owner: TargetActor, at: DateTime): Promise<number> {
        const actorId = this.requireUserOwner(owner);
        const result = await this.db
            .updateTable('deadair.actorsApikeyFactors')
            .set({ revokedAt: at })
            .where('actorId', '=', actorId)
            .where('revokedAt', 'is', null)
            .executeTakeFirst();
        return Number(result.numUpdatedRows);
    }

    /** Deliberately nothing: a use is a `login_events` row, written where the caller's address is known. */
    async touchLastUsed(_id: string, _at: DateTime): Promise<void> {}

    /** Destroy a key and every tuple that made it one. */
    async delete(id: string): Promise<void> {
        const row = await this.db.selectFrom('deadair.actorsApikeyFactors').selectAll().where('id', '=', id).executeTakeFirst();
        if (!row) return;
        const scopes = await this.scopesOf(id, row.actorId);
        await this.tuples.delete(tuplesFor(id, row.actorId, scopes));
        await this.db.deleteFrom('deadair.actorsApikeyFactors').where('id', '=', id).execute();
    }

    private async scopesOf(keyId: string, actorId: string): Promise<ApiKeyScope[]> {
        const relations = await this.tuples.listRelationsForSubjectOnObject({ namespace: APIKEY_NAMESPACE, id: keyId }, userSubject(actorId));
        return parseApiKeyScopes(relations);
    }

    /** Scopes from the tuple store and last use from `login_events`, for a list or a single key. */
    private async hydrate(rows: ReadonlyArray<ApiKeyRow>): Promise<ApiKey[]> {
        if (rows.length === 0) return [];
        const [scopes, lastUsed] = await Promise.all([Promise.all(rows.map(row => this.scopesOf(row.id, row.actorId))), this.lastUsedOf(rows)]);
        return rows.map((row, i) => this.toModel(row, scopes[i] ?? [], lastUsed.get(row.id)));
    }

    /** The latest `login_events` row per key, read through that table's `(actor_id, occurred_at)` index. */
    private async lastUsedOf(rows: ReadonlyArray<ApiKeyRow>): Promise<Map<string, DateTime>> {
        const actorIds = [...new Set(rows.map(row => row.actorId))];
        const used = await this.db
            .selectFrom('deadair.loginEvents')
            .select(eb => ['factorId', eb.fn.max('occurredAt').as('lastUsedAt')])
            .where('actorId', 'in', actorIds)
            .where('factorType', '=', 'apikey')
            .where(
                'factorId',
                'in',
                rows.map(row => row.id),
            )
            .groupBy('factorId')
            .execute();
        const byKey = new Map<string, DateTime>();
        for (const entry of used) {
            // SQL NULL reads back as `undefined` whatever the generated type says (`apps/api/CLAUDE.md`).
            if (entry.factorId == null || entry.lastUsedAt == null) continue;
            byKey.set(entry.factorId, entry.lastUsedAt as DateTime);
        }
        return byKey;
    }

    private async requireRow(id: string): Promise<ApiKeyRow> {
        const row = await this.db.selectFrom('deadair.actorsApikeyFactors').selectAll().where('id', '=', id).executeTakeFirst();
        if (!row) throw httpError(404).withDetails({ id: 'not found' });
        return row;
    }

    private async requireKey(id: string): Promise<ApiKey> {
        const key = await this.findById(id);
        if (!key) throw httpError(404).withDetails({ id: 'not found' });
        return key;
    }

    /**
     * A station key belongs to a person. Anything else is a caller passing the wrong owner, which is a
     * bug in this process rather than a request to refuse politely.
     */
    private requireUserOwner(owner: TargetActor): string {
        if (owner.kind !== OWNER_KIND) {
            throw new Error(`API keys belong to a user; refusing an owner of kind ${owner.kind}`);
        }
        return owner.actorId;
    }

    /** Absent optionals are dropped rather than passed through, per the `== null` rule. */
    private toModel(row: ApiKeyRow, scopes: ReadonlyArray<ApiKeyScope>, lastUsedAt?: DateTime): ApiKey {
        return {
            id: row.id,
            owner: { kind: OWNER_KIND, actorId: row.actorId },
            name: row.name,
            hint: row.hint,
            secretHash: row.secretHash,
            scopes: [...scopes],
            metadata: {},
            createdAt: row.createdAt,
            ...(row.expiresAt == null ? {} : { expiresAt: row.expiresAt }),
            ...(lastUsedAt === undefined ? {} : { lastUsedAt }),
            ...(row.revokedAt == null ? {} : { revokedAt: row.revokedAt }),
        };
    }
}
