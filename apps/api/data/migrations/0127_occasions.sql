-- migrate:up

-- What a date means where this station is: a name the writers can say, and a mood to lean into on a
-- day the slot on air names none. Not the almanac, which answers what happened on a date anywhere in
-- the world. `schedule/occasion.rule.ts` says what each kind of rule means and why there are five.
--
-- One row per occasion, with the rule's fields as columns and a check saying which belong to which
-- kind, so a rule the reader cannot act on cannot be stored.
create table deadair.occasions (
    id uuid primary key default gen_random_uuid(),
    -- Present for the reason it is on every other station-owned table.
    station_key text not null default 'main',
    -- Said on air as written: "Halloween", "the first day of Hanukkah".
    words text not null constraint occasions_words_check check (length(btrim(words)) between 1 and 80),
    rule_kind text not null constraint occasions_rule_kind_check check (rule_kind in ('fixed', 'weekday', 'easter', 'calendar', 'dates')),
    -- `fixed` and `weekday`.
    month smallint constraint occasions_month_check check (month between 1 and 12),
    -- `fixed` and `calendar`. The day of the month in that rule's own calendar.
    day smallint constraint occasions_day_check check (day between 1 and 31),
    -- `weekday`. 1 to 5, or -1 for the last. 0 is Sunday, as the station's calendar has it everywhere.
    ordinal smallint constraint occasions_ordinal_check check (ordinal in (1, 2, 3, 4, 5, -1)),
    weekday smallint constraint occasions_weekday_check check (weekday between 0 and 6),
    -- `easter`. Days from Easter Sunday.
    offset_days smallint constraint occasions_offset_days_check check (offset_days between -60 and 60),
    -- `calendar`. The month as `Intl` names it in English in that calendar: `Tishri`, `Shawwal`.
    calendar text constraint occasions_calendar_check check (calendar is null or calendar in ('hebrew', 'islamic-umalqura')),
    calendar_month text constraint occasions_calendar_month_check check (length(btrim(calendar_month)) between 1 and 40),
    -- `dates`. `YYYY-MM-DD`, for what no rule here can work out.
    dates text[],
    -- One of the seven, and absent means this day leans nothing. A slot that names its own always wins.
    mood text constraint occasions_mood_check check (mood is null or mood in ('love', 'happiness', 'comfort', 'sadness', 'loneliness', 'anger', 'fear')),
    enabled boolean not null default true,
    -- First match wins, lowest first. Two occasions can share a date: Hanukkah falls on Christmas Day in 2027.
    position integer not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint occasions_rule_check check (
        case rule_kind
            when 'fixed' then month is not null and day is not null
            when 'weekday' then month is not null and ordinal is not null and weekday is not null
            when 'easter' then offset_days is not null
            when 'calendar' then calendar is not null and calendar_month is not null and day is not null
            when 'dates' then dates is not null and cardinality(dates) between 1 and 200
        end
    )
);

create index occasions_station_position_idx on deadair.occasions (station_key, position);

select deadair.add_updated_at_trigger('deadair.occasions');

-- A starter list, so a fresh install already knows about New Year and Halloween. None names a mood, so
-- none changes what is drawn until an operator gives it one.
--
-- The eight that are on are the ones a station anywhere could reasonably say. The rest belong to a
-- country or a faith, and this table has no way of knowing which station it is on, so they wait a
-- switch away rather than have somebody in Leeds told it is Thanksgiving.
insert into deadair.occasions (words, rule_kind, month, day, position) values
    ('New Year''s Day', 'fixed', 1, 1, 10),
    ('Valentine''s Day', 'fixed', 2, 14, 20),
    ('St Patrick''s Day', 'fixed', 3, 17, 30),
    ('Halloween', 'fixed', 10, 31, 50),
    ('Christmas Eve', 'fixed', 12, 24, 60),
    ('Christmas Day', 'fixed', 12, 25, 70),
    ('New Year''s Eve', 'fixed', 12, 31, 80);

insert into deadair.occasions (words, rule_kind, offset_days, position) values
    ('Easter Sunday', 'easter', 0, 40);

insert into deadair.occasions (words, rule_kind, month, ordinal, weekday, enabled, position) values
    ('Thanksgiving', 'weekday', 11, 4, 4, false, 100),
    ('Memorial Day', 'weekday', 5, -1, 1, false, 110),
    ('Labor Day', 'weekday', 9, 1, 1, false, 120),
    ('Mother''s Day', 'weekday', 5, 2, 0, false, 130),
    ('Father''s Day', 'weekday', 6, 3, 0, false, 140);

insert into deadair.occasions (words, rule_kind, month, day, enabled, position) values
    ('Independence Day', 'fixed', 7, 4, false, 150),
    ('Boxing Day', 'fixed', 12, 26, false, 160),
    ('Bonfire Night', 'fixed', 11, 5, false, 170);

insert into deadair.occasions (words, rule_kind, calendar, calendar_month, day, enabled, position) values
    ('Rosh Hashanah', 'calendar', 'hebrew', 'Tishri', 1, false, 180),
    ('Yom Kippur', 'calendar', 'hebrew', 'Tishri', 10, false, 190),
    ('the first day of Hanukkah', 'calendar', 'hebrew', 'Kislev', 25, false, 200),
    ('Eid al-Fitr', 'calendar', 'islamic-umalqura', 'Shawwal', 1, false, 210),
    ('Eid al-Adha', 'calendar', 'islamic-umalqura', 'Dhuʻl-Hijjah', 10, false, 220);

-- migrate:down

drop table if exists deadair.occasions;
