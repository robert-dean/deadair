-- migrate:up

-- An invitation: an admin asking somebody, by address, to take an account in a role.
--
-- The token is never stored in the clear, on the party pass's rule (0085). `token_hash` is how the
-- invite page finds the invitation; `token_sealed` is the token encrypted with the station's root key,
-- so the console can show the link and its QR code again while the invitation is open.
--
-- `state` holds only what somebody DID: pending, accepted, revoked. Expiry is worked out on read
-- from `expires_at`, so nothing has to sweep the table and a pending row past its time simply reads
-- as expired. Nothing here is ever deleted: a revoked or expired invitation keeps its row, and so
-- does an accepted one, which is how the station remembers who invited whom.
create table deadair.invitations (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    email text not null,
    role text not null check (role in ('admin', 'listener')),
    state text not null default 'pending' check (state in ('pending', 'accepted', 'revoked')),
    token_hash text not null unique,
    token_sealed text not null,
    expires_at timestamptz not null check (expires_at > created_at),
    invited_by uuid references deadair.actors (id) on delete set null,
    accepted_at timestamptz,
    accepted_by uuid references deadair.actors (id) on delete set null,
    revoked_at timestamptz,
    revoked_by uuid references deadair.actors (id) on delete set null,
    constraint invitations_accepted_shape check (state <> 'accepted' or accepted_at is not null),
    constraint invitations_revoked_shape check (state <> 'revoked' or revoked_at is not null)
);

-- One open invitation per address: inviting the same person again revokes the first, which is how a
-- resend works without two live links for one account.
create unique index invitations_one_pending_per_email on deadair.invitations (lower(email)) where state = 'pending';
create index invitations_created_at_idx on deadair.invitations (created_at desc);

-- migrate:down

drop table deadair.invitations;
