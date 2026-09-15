-- migrate:up

-- A personal API key: a bearer credential an account mints for itself, for a script or an
-- integration that should not hold a person's session. ServerKit's `ApiKeyService` owns the token
-- and this table is its `ApiKeyRepository`.
--
-- Beside the other `actors_*_factors` tables because that is what it is to the session machinery:
-- a request made with a key carries one `apikey` factor. It is never an enrolled factor, though, and
-- nothing that lists factors for sign-in or step-up reads this table.
--
-- ## What is not here, and where it is
--
-- **The token.** Only its SHA-256 and its first eight characters are kept, so a lost token cannot be
-- recovered, only rotated. SHA-256 and not Argon2 like `actors_password_factors`, on ServerKit's
-- argument: a password is guessable and a KDF is what makes guessing slow, while a key body is 32
-- random bytes that cannot be guessed, and a memory-hard hash on every request would make each one a
-- way to burn the server's CPU. A plain digest is also what lets `secret_hash` be the lookup key, so
-- a request costs one indexed read rather than a comparison against every key.
--
-- **The scopes.** What a key may do lives in `permissions_relation_tuples`, as an `apikey` object
-- (`data/permissions/core.perm`) whose owner, station link and `scoped_*` relations are written
-- beside this row. That is what makes a key inherit from its owner live: take a role away and every
-- key the account holds loses it on the next request, with nothing here to update.
--
-- **When it was last used.** A use is a row in `login_events`, which already exists as one row per
-- successful authentication and which carries the caller's address, the forensic half a timestamp
-- column would not. Written at most once per five minutes per key, so a poller costs a row per window
-- rather than one per request.
--
-- ## Revoking keeps the row
--
-- `revoked_at` withdraws a key and every validation fails from the next request, because nothing
-- caches one. The row stays so the account's list can say what was withdrawn and when, and so a
-- revoked key still being presented is logged as that rather than as a token nobody recognises.
--
-- ## Postgres, not Redis
--
-- Sessions live in Redis and survive a schema rebuild (`apps/api/CLAUDE.md`, "Sessions outlive the
-- database"). Keys are the other way round: `flush:sessions` leaves every key working, and a rebuild
-- removes them, which is right, because a rebuild removes the account they act for.
create table deadair.actors_apikey_factors (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid primary key default gen_random_uuid(),
    actor_id uuid not null references deadair.actors (id),
    -- What the account called it, so a list of three keys says which is the doorbell and which is
    -- the backup script.
    name text not null check (length(btrim(name)) > 0),
    -- The token's first eight characters: the prefix and a few of the body, enough to recognise a
    -- key in a list or in a config file and far too few to be one.
    hint text not null,
    -- SHA-256 of the whole token, lowercase hex. The hot-path lookup key, and unique because two
    -- rows sharing one would be two keys sharing a token.
    secret_hash text not null unique,
    -- Absent: the key never expires.
    expires_at TIMESTAMPTZ,
    -- Present: the key has been withdrawn, at this moment. A second revoke keeps the first time.
    revoked_at TIMESTAMPTZ,
    check (expires_at is null or expires_at > created_at)
);
select deadair.add_updated_at_trigger('deadair.actors_apikey_factors');
create index actors_apikey_factors_actor_idx
    on deadair.actors_apikey_factors (actor_id, created_at desc);

-- migrate:down

drop table deadair.actors_apikey_factors;
