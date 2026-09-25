-- migrate:up

-- The console language each operator chose, kept with their account so it follows them from one
-- browser to the next. No row means none was chosen, and the console follows the browser's own
-- preference among the languages this station has, falling back to English.
--
-- Keyed by actor alone: a person's language is theirs, not a station's. The locale is not a foreign
-- key to `console_languages`, because English is a choice with no pack behind it, and a choice whose
-- pack an admin later removes is a console that shows English until the operator chooses again,
-- which is what an absent row does anyway.
create table deadair.console_language_choices (
    actor_id uuid not null primary key references deadair.actors (id) on delete cascade,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    locale text not null check (locale <> '')
);

select deadair.add_updated_at_trigger('deadair.console_language_choices');

-- migrate:down

drop table deadair.console_language_choices;
