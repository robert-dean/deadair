-- migrate:up

-- The station as an OAuth 2.1 authorization server, for apps that connect to it as one of its
-- operators: Claude's connectors first among them, reaching the MCP endpoint. The flow itself lives
-- in @maroonedsoftware/authentication (`OAuthAuthorizationServer`); these two tables are the
-- repositories it asks the station to keep.
--
-- ## What is not here
--
-- **Tokens.** A grant mints an ordinary session, in Redis beside every console session, bound to the
-- MCP resource as its audience and carrying `claims.oauth`. Revoking a grant deletes those sessions.
--
-- **Clients that describe themselves.** An app whose client id is the https URL of its own metadata
-- document (Claude Code is one) is fetched and cached, never stored, which is why a grant's
-- `client_id` does not reference `oauth_clients`.
--
-- **Authorization requests and codes.** Both last minutes and live in Redis.

-- An app allowed to ask for a token. `preregistered` is one an operator created in the console,
-- with a secret if it keeps one; `dynamic` registered itself (RFC 7591), which is how Claude connects
-- without anybody creating it first, and which it does once per connection. So a dynamic client
-- expires after a stretch of disuse, each use pushing that out, and a daily job deletes the expired.
create table deadair.oauth_clients (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    client_id text primary key,
    kind text not null check (kind in ('preregistered', 'dynamic')),
    -- What the app calls itself, shown on the consent page and in the lists.
    name text,
    -- Exact match, except that a loopback address matches on any port (RFC 8252).
    redirect_uris text[] not null check (cardinality(redirect_uris) > 0),
    token_endpoint_auth_method text not null check (token_endpoint_auth_method in ('none', 'client_secret_post', 'client_secret_basic')),
    -- SHA-256 hex of the secret, for a client that keeps one; the secret itself is shown once.
    secret_hash text,
    client_uri text,
    logo_uri text,
    -- Who created a pre-registered client. Absent for one that registered itself.
    created_by uuid references deadair.actors (id) on delete set null,
    -- When a dynamic client lapses. Absent: never, which is every pre-registered one.
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    -- Withdrawn by an operator. The row stays so a list can say so.
    revoked_at TIMESTAMPTZ,
    check ((token_endpoint_auth_method = 'none') = (secret_hash is null))
);
select deadair.add_updated_at_trigger('deadair.oauth_clients');
create index oauth_clients_expiry_idx on deadair.oauth_clients (expires_at) where expires_at is not null;

-- One operator's approval of one app for one resource. Approving the same app again reuses the row,
-- un-revoking it, and every token the app holds carries its id, which is what lets a person
-- disconnect an app from the Security page and have every one of those tokens stop at once.
create table deadair.oauth_grants (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid primary key default gen_random_uuid(),
    client_id text not null,
    actor_id uuid not null references deadair.actors (id) on delete cascade,
    resource text not null,
    scope text[] not null default '{}',
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    unique (client_id, actor_id, resource)
);
select deadair.add_updated_at_trigger('deadair.oauth_grants');
create index oauth_grants_actor_idx on deadair.oauth_grants (actor_id, created_at desc);

-- migrate:down

drop table deadair.oauth_grants;
drop table deadair.oauth_clients;
