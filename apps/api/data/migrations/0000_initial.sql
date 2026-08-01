-- migrate:up

do $$
begin
    if not exists (select from pg_roles where rolname = 'app_user') then
        create role app_user nologin nosuperuser noinherit nobypassrls;
    end if;
end $$;

alter default privileges grant select, insert, update, delete on tables to app_user;
alter default privileges grant usage, select on sequences to app_user;
alter default privileges grant usage on schemas to app_user;

-- public pre-exists (not created by a migration) so it misses the schema
-- default above; grant it explicitly.
grant usage on schema public to app_user;

create schema if not exists deadair;

-- =========================================================================
-- deadair.set_updated_at() — BEFORE UPDATE trigger. Sets updated_at to
-- current_timestamp when the row actually changes; returns OLD to suppress
-- the update (and downstream triggers) when nothing changed.
-- =========================================================================

create or replace function deadair.set_updated_at() returns trigger
    language plpgsql
as $$
begin
    if row(NEW.*) is distinct from row(OLD.*) then
        NEW.updated_at := current_timestamp;
        return NEW;
    else
        return OLD;
    end if;
end;
$$;

create or replace function deadair.add_updated_at_trigger(tbl regclass) returns void as $$
begin
    if exists (
        select 1 from pg_attribute
         where attrelid = tbl and attname = 'updated_at' and not attisdropped
    ) then
        execute format('drop trigger if exists deadair_set_updated_at_trigger on %s', tbl);
        execute format(
            'create trigger deadair_set_updated_at_trigger before update on %s for each row execute function deadair.set_updated_at()',
            tbl
        );
    end if;
end;
$$ language plpgsql;

-- migrate:down


-- Reverse the global default privileges so a re-up re-asserts them cleanly.
-- Guarded on app_user existing: this migration's UP creates the role, but a
-- database first migrated before the role existed (in-place migration edit) can
-- reach this down without it. The role itself is intentionally left in place —
-- it is cluster-global and shared by every per-test database in this cluster,
-- and DROP ROLE would fail while any of them still holds a grant; the up guard
-- re-uses it.
do $$
begin
    if exists (select from pg_roles where rolname = 'app_user') then
        execute 'alter default privileges revoke select, insert, update, delete on tables from app_user';
        execute 'alter default privileges revoke usage, select on sequences from app_user';
        execute 'alter default privileges revoke usage on schemas from app_user';
        execute 'revoke usage on schema public from app_user';
    end if;
end $$;


drop function if exists deadair.add_updated_at_trigger(regclass);
drop function if exists deadair.set_updated_at();

drop schema if exists deadair cascade;
