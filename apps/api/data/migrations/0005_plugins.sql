-- migrate:up

create or replace function deadair.notify_plugins_changed() returns trigger as $$
begin
    perform pg_notify('deadair_plugins_changed', coalesce(new.plugin_id, old.plugin_id));
    return null;
end;
$$ language plpgsql;

create table deadair.plugin_configs (
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    plugin_id text primary key,
    enabled boolean not null default false,
    config jsonb not null default '{}',
    secrets jsonb not null default '{}',
    status text,
    last_error text,
    log_level text not null default 'warn' check (log_level in ('debug', 'info', 'warn', 'error'))
);
select deadair.add_updated_at_trigger('deadair.plugin_configs');
create trigger notify_plugins_changed
    after insert or update or delete on deadair.plugin_configs
    for each row execute function deadair.notify_plugins_changed();

create table deadair.plugin_storage (
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    plugin_id text not null,
    key text not null,
    value jsonb,
    primary key (plugin_id, key)
);
select deadair.add_updated_at_trigger('deadair.plugin_storage');

-- migrate:down

drop table if exists deadair.plugin_storage;
drop table if exists deadair.plugin_configs;
drop function if exists deadair.notify_plugins_changed();
