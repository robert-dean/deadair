-- migrate:up

-- Each kind of call names its models as an ordered LIST now, rather than one model.
--
-- A model that fails before it answers hands the call to the next one on the list, and the order is
-- the operator's preference. The setting stays one row per kind of call and stays text, as every
-- setting is: the value is the `list` encoding the console already writes for a one-column list,
-- `[{"model":"provider:model"}]`. So each model that was set becomes a list of one, which is exactly
-- what the station did before, and an empty value stays empty, which still means the plugin's own
-- default.
--
-- A value already shaped like a list is left alone, so running this against a row somebody has
-- already saved from the new page changes nothing. `modelList` also reads a bare `provider:model` as
-- a list of one, so a row this misses is never silently the default.
update deadair.settings
set value = jsonb_build_array(jsonb_build_object('model', btrim(value)))::text
where key in (
        'llm.breakModel',
        'llm.setModel',
        'llm.factModel',
        'llm.moodModel',
        'llm.subjectModel',
        'llm.personaNotesModel',
        'llm.personaStoriesModel',
        'llm.personaModel'
    )
    and value is not null
    and btrim(value) <> ''
    and left(btrim(value), 1) <> '[';

-- migrate:down

-- Back to one model: the first on the list, which is the one the station asked first anyway. The
-- production list did not exist before and is removed.
update deadair.settings
set value = coalesce((value::jsonb -> 0 ->> 'model'), '')
where key in (
        'llm.breakModel',
        'llm.setModel',
        'llm.factModel',
        'llm.moodModel',
        'llm.subjectModel',
        'llm.personaNotesModel',
        'llm.personaStoriesModel',
        'llm.personaModel'
    )
    and value is not null
    and left(btrim(value), 1) = '[';

delete from deadair.settings where key = 'llm.productionModel';
