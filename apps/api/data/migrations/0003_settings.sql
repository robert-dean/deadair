-- migrate:up

create or replace function deadair.notify_settings_changed() returns trigger as $$
begin
    perform pg_notify('deadair_settings_changed', coalesce(new.key, old.key));
    return null;
end;
$$ language plpgsql;

create table deadair.settings (
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    key text primary key,
    value text
);
select deadair.add_updated_at_trigger('deadair.settings');
create trigger notify_settings_changed
    after insert or update or delete on deadair.settings
    for each row execute function deadair.notify_settings_changed();

-- migrate:down

drop table if exists deadair.settings;
