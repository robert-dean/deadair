-- migrate:up

-- Who somebody on a chat platform is to the station.
--
-- Anybody in a chat the station listens in is a listener, and needs no row. A row here says that one
-- person on one platform IS one of the station's own accounts, so the station may act on their
-- operator commands (skip, stop, start) with that account's permissions. The permissions themselves
-- are read fresh on every command, never copied here, so an account that loses its role stops being
-- obeyed on its very next command.
--
-- **Keyed on the platform's user id, not a handle**, because a handle is something a person can give
-- away and somebody else can take. **Cascades from the actor**, since a link to a deleted account is
-- a link to nobody. `plugin_id` is not a foreign key, for `messaging_cursors`' reason.
create table deadair.messaging_identities (
    plugin_id text not null,
    platform_user_id text not null,
    actor_id uuid not null references deadair.actors (id) on delete cascade,
    -- What the platform called them when they linked, so the console can say which chat account a
    -- link is. Never used as a key.
    display_name text not null,
    created_at timestamptz not null default now(),
    primary key (plugin_id, platform_user_id)
);

create index messaging_identities_actor_idx on deadair.messaging_identities (actor_id);

-- A one-time code a signed-in account sends to the bot to prove the chat account is theirs.
--
-- Only the HASH is kept: the code is shown once, in the console, to the person who asked for it, and
-- a database read must not be enough to link somebody else's chat account to an operator. One live
-- code per account (the primary key), short-lived, and deleted when it is used.
create table deadair.messaging_link_codes (
    actor_id uuid not null primary key references deadair.actors (id) on delete cascade,
    code_hash text not null unique,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);

-- migrate:down

drop table if exists deadair.messaging_link_codes;
drop table if exists deadair.messaging_identities;
