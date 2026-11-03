-- migrate:up

-- The web search plugin's one `apiKey` becomes a key per engine, so changing the engine can no
-- longer send one company's credential to the other.
--
-- A stored key moves to the engine the install is on, which is the only engine it can be assumed to
-- belong to. On anything else, SearXNG included, nothing says whose it is and nothing reads it, so it
-- goes: the operator is asked for a key when they next choose a keyed engine. The ciphertext moves as
-- it is, because a value is encrypted on its own and not against the key it is stored under.
update deadair.plugin_configs
set secrets = (secrets - 'apiKey') || case
    when config ->> 'provider' = 'brave' then jsonb_build_object('braveApiKey', secrets -> 'apiKey')
    when config ->> 'provider' = 'tavily' then jsonb_build_object('tavilyApiKey', secrets -> 'apiKey')
    else '{}'::jsonb
end
where plugin_id = 'deadair.websearch' and secrets ? 'apiKey';

-- migrate:down

update deadair.plugin_configs
set secrets = (secrets - 'braveApiKey' - 'tavilyApiKey') || case
    when config ->> 'provider' = 'brave' and secrets ? 'braveApiKey' then jsonb_build_object('apiKey', secrets -> 'braveApiKey')
    when config ->> 'provider' = 'tavily' and secrets ? 'tavilyApiKey' then jsonb_build_object('apiKey', secrets -> 'tavilyApiKey')
    else '{}'::jsonb
end
where plugin_id = 'deadair.websearch' and (secrets ? 'braveApiKey' or secrets ? 'tavilyApiKey');
