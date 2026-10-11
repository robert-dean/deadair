-- migrate:up

-- A quirk becomes an object, `{ "text": ..., "cadence": ... }`, so it can say how often it applies.
--
-- Every quirk went out on every prompt, and one that read "once in a while, yell for Sharon" was
-- written 0 times in 58 breaks: a writer with no memory of the last break reads "once in a while"
-- as "not this time", every time. So the station decides when, as it already does for a
-- preoccupation, and the quirk carries a cadence (`often`, `occasionally`, `rarely`) instead of
-- saying "now and then" in its own words. Absent means `always`, which is what every quirk was.
--
-- A rung on the entry rather than another list beside `quirks` and `preoccupations`, because a list
-- per rhythm costs a column, a contract field, four SDKs and two editors for every rhythm anybody
-- thinks of next. `persona.sheet.ts` has the rest, beside `PersonaQuirk`.
--
-- Each string becomes `{ "text": <string> }` with no cadence, so nothing a station says changes. An
-- element that is already an object is kept, which makes this safe to meet twice.
update deadair.personas
set quirks = (
    select coalesce(
        jsonb_agg(case when jsonb_typeof(element) = 'string' then jsonb_build_object('text', element) else element end order by position),
        '[]'::jsonb
    )
    from jsonb_array_elements(quirks) with ordinality as entries(element, position)
)
where jsonb_typeof(quirks) = 'array';

-- migrate:down

-- Back to strings, which loses every cadence: a quirk that was `rarely` becomes a rule again.
update deadair.personas
set quirks = (
    select coalesce(
        jsonb_agg(case when jsonb_typeof(element) = 'object' then element -> 'text' else element end order by position),
        '[]'::jsonb
    )
    from jsonb_array_elements(quirks) with ordinality as entries(element, position)
)
where jsonb_typeof(quirks) = 'array';
