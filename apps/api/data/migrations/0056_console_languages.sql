-- migrate:up

-- The languages the console can be shown in, beyond the English it is built with. Each row is a
-- language pack an admin imported: every word the console says, in one language, as the file a
-- translator made (`apps/web/src/i18n/language.pack.ts` is the format).
--
-- The console's language and nothing else. What the station BROADCASTS in is `stream.language`, a
-- setting, and nothing reads this table to decide it; the two are never wired together.
--
-- Stored as the pack's catalog verbatim rather than checked into rows per string, because whether a
-- string fits depends on the English it translates, which is whatever the reading CONSOLE was built
-- with. So the API holds the file and the console judges it, when it is imported and again each time
-- a console loads it after an upgrade.
create table deadair.console_languages (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    -- Whose console this is, as on every other station-owned table.
    station_key text not null default 'main',
    -- The language, as a canonical BCP 47 tag: `de`, `pt-BR`. Never English, which is built in and
    -- is what every other language falls back to, key by key.
    locale text not null check (locale <> '' and lower(split_part(locale, '-', 1)) <> 'en'),
    -- The language's name in itself, as the console's picker shows it: `Deutsch`.
    name text not null check (name <> ''),
    direction text not null default 'ltr' constraint console_languages_direction_check check (direction in ('ltr', 'rtl')),
    -- The console version the pack was translated against, as the file said. Empty for a file that
    -- did not say.
    made_for text not null default '',
    -- The strings, nested by namespace, exactly as the pack carried them.
    catalog jsonb not null,
    -- Who imported it. Stays on this station: it is not part of the pack and does not travel with an
    -- export, on the rule persona export settled for provenance (Ideas #6).
    imported_by uuid references deadair.actors (id) on delete set null,

    -- One pack per language. Importing a language again replaces it.
    constraint console_languages_locale_unique unique (station_key, locale)
);

select deadair.add_updated_at_trigger('deadair.console_languages');

-- migrate:down

drop table deadair.console_languages;
