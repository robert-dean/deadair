import type { ConfigField } from '@deadair/plugin-sdk';

/**
 * Reserved secret key the OAuth token vault lives under. The `oauth.` prefix is
 * off limits to manifests, so a plugin cannot declare a config field that
 * collides with (or reads back) its own token blob through the settings form.
 */
export const PLUGIN_OAUTH_SECRET_KEY = 'oauth.tokens';

export const OAUTH_SECRET_FIELD: ConfigField = {
    key: PLUGIN_OAUTH_SECRET_KEY,
    label: 'OAuth tokens',
    type: 'secret',
};
