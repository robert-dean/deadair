import type { SdkOptions } from './sdk-options.js';
import { createSdkFetch } from './sdk-options.js';
import { AuthenticationClient } from './authentication/authentication.client.js';
import { CatalogClient } from './catalog/catalog.client.js';
import { OnboardingClient } from './onboarding/onboarding.client.js';
import { PlaylistsClient } from './playlists/playlists.client.js';
import { PlayoutClient } from './playout/playout.client.js';
import { PluginsClient } from './plugins/plugins.client.js';

export class DeadairSdk {
    readonly authentication: AuthenticationClient;
    readonly catalog: CatalogClient;
    readonly onboarding: OnboardingClient;
    readonly playlists: PlaylistsClient;
    readonly playout: PlayoutClient;
    readonly plugins: PluginsClient;

    constructor(options: SdkOptions) {
        const sdkFetch = options.fetch ?? createSdkFetch(options);
        this.authentication = new AuthenticationClient(sdkFetch);
        this.catalog = new CatalogClient(sdkFetch);
        this.onboarding = new OnboardingClient(sdkFetch);
        this.playlists = new PlaylistsClient(sdkFetch);
        this.playout = new PlayoutClient(sdkFetch);
        this.plugins = new PluginsClient(sdkFetch);
    }
}
