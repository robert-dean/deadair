-- migrate:up

create table deadair.actors (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid primary key default gen_random_uuid(),
    active boolean not null default true,
    type text not null check (type in ('user', 'system', 'vendor'))
);
select deadair.add_updated_at_trigger('deadair.actors');

create table deadair.actors_email_factors (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid primary key default gen_random_uuid(),
    actor_id uuid not null references deadair.actors (id),
    value text not null,
    active boolean not null default true
);
select deadair.add_updated_at_trigger('deadair.actors_email_factors');
create unique index actors_email_factors_value_lower_idx
    on deadair.actors_email_factors (lower(value));

create table deadair.actors_password_factors (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    actor_id uuid primary key references deadair.actors (id),
    hash text not null,
    salt text not null,
    active boolean not null default true,
    needs_reset boolean not null default false
);
select deadair.add_updated_at_trigger('deadair.actors_password_factors');

-- Append-only archive of prior password hashes so PasswordFactorService can enforce
-- the no-reuse policy (listPreviousPasswords). The repository inserts a row here
-- whenever the live password_factors row is rotated; rows are never updated.
create table deadair.actors_password_factors_archive (
    id uuid primary key default gen_random_uuid(),
    actor_id uuid not null references deadair.actors (id),
    hash text not null,
    salt text not null,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
create index actors_password_factors_archive_actor_idx
    on deadair.actors_password_factors_archive (actor_id, archived_at desc);

create table deadair.actors_fido_factors (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid primary key default gen_random_uuid(),
    actor_id uuid not null references deadair.actors (id),
    public_key text not null,
    public_key_id text not null unique,
    counter int not null,
    active boolean not null default true,
    label text
);
select deadair.add_updated_at_trigger('deadair.actors_fido_factors');

create table deadair.actors_authenticator_factors (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid primary key default gen_random_uuid(),
    actor_id uuid not null references deadair.actors (id),
    secret text not null,
    secret_dek text not null,
    type text not null check (type in ('totp', 'hotp')),
    algorithm text not null check (algorithm in ('sha1', 'sha256', 'sha512')),
    token_length int not null check (token_length >= 6), -- minimum token length is 6
    period_seconds int not null check (period_seconds >= 30), -- minimum period is 30 seconds
    counter int not null check (counter >= 0),
    active boolean not null default true,
    label text
);
select deadair.add_updated_at_trigger('deadair.actors_authenticator_factors');

create table deadair.actors_oidc_factors (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid primary key default gen_random_uuid(),
    actor_id uuid not null references deadair.actors (id),
    active boolean not null default true,
    provider text not null,
    subject text not null,
    email text,
    -- Last-seen avatar URL from the IdP (e.g. Google's `picture` claim). Stashed
    -- here until a person record exists to attach a downloaded avatar document to.
    picture text,
    encrypted_refresh_token text,
    encrypted_refresh_token_dek text,
    refresh_token_expires_at TIMESTAMPTZ
);
create unique index actors_oidc_factors_provider_subject_lower_idx
    on deadair.actors_oidc_factors (lower(provider), subject);
create index actors_oidc_factors_actor_id_idx
    on deadair.actors_oidc_factors (actor_id);
create index actors_oidc_factors_email_lower_idx
    on deadair.actors_oidc_factors (lower(email));
select deadair.add_updated_at_trigger('deadair.actors_oidc_factors');

insert into deadair.actors (id, active, type) values
    ('00000000-0000-4000-8000-000000000001', true, 'system');

-- Append-only log of session lifecycle events. Written by AuthenticationSessionService
-- hooks (onSessionCreated, onSessionRefreshed, onSessionRevoked, onValidationFailed,
-- onRefreshReuseDetected). Drives admin/user "active sessions" listing via the latest
-- event per session_token, filtered by a Redis EXISTS check at read time.
create table deadair.actor_session_events (
    id bigserial primary key,
    session_token text not null,
    actor_id uuid not null references deadair.actors (id),
    event_type text not null check (event_type in (
        'created', 'refreshed', 'revoked', 'expired', 'step_up', 'validation_failed'
    )),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip inet,
    user_agent text,
    metadata jsonb
);
create index actor_session_events_session_token_idx
    on deadair.actor_session_events (session_token, occurred_at desc);
create index actor_session_events_actor_id_idx
    on deadair.actor_session_events (actor_id, occurred_at desc);

-- One row per successful authentication. Recorded by AuthenticationService after
-- issueTokenForSession returns. Failures are aggregated in login_failure_counters
-- below rather than written here.
create table deadair.login_events (
    id bigserial primary key,
    actor_id uuid not null references deadair.actors (id),
    factor_type text not null,
    factor_id uuid,
    session_token text,
    ip inet,
    user_agent text,
    mfa_satisfied boolean not null,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
create index login_events_actor_id_idx
    on deadair.login_events (actor_id, occurred_at desc);

-- Rolled-up counter of failed authentication attempts. Bucketed in 5-minute windows
-- so one row covers many attempts. identifier_hash lets us count attempts against an
-- unknown actor (e.g. wrong-email password attempts) without indexing PII.
create table deadair.login_failure_counters (
    bucket_start TIMESTAMPTZ NOT NULL,
    identifier_hash text not null,
    factor_type text not null,
    ip inet not null,
    attempt_count int not null default 1,
    last_reason text,
    actor_id uuid references deadair.actors (id),
    identifier text,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    primary key (bucket_start, identifier_hash, factor_type, ip)
);

-- migrate:down

drop table if exists deadair.login_failure_counters;
drop table if exists deadair.login_events;
drop table if exists deadair.actor_session_events;
drop table if exists deadair.actors_oidc_factors;
drop table if exists deadair.actors_authenticator_factors;
drop table if exists deadair.actors_fido_factors;
drop table if exists deadair.actors_password_factors_archive;
drop table if exists deadair.actors_password_factors;
drop table if exists deadair.actors_email_factors;
drop table if exists deadair.actors;
