-- migrate:up

-- A connected app's grant is now narrowed by the station scopes in its `scope` column (`view`,
-- `manage`), which the `oauthgrant` namespace in `core.perm` derives its tuples from. Every grant
-- written before that holds only `mcp`, and read under the new rule it would allow nothing. It was
-- approved as the whole of the person's account, so it is given both, which is what it already meant.
update deadair.oauth_grants
   set scope = scope || array['view', 'manage']
 where not (scope && array['view', 'manage']);

-- migrate:down

update deadair.oauth_grants
   set scope = array_remove(array_remove(scope, 'view'), 'manage');
