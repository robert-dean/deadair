import type { SdkOptions } from './sdk-options.js';
import { createSdkFetch } from './sdk-options.js';
import { ActivityClient } from './activity/activity.client.js';
import { ArtClient } from './art/art.client.js';
import { AuthenticationClient } from './authentication/authentication.client.js';
import { CatalogClient } from './catalog/catalog.client.js';
import { ChartsClient } from './charts/charts.client.js';
import { DirectorClient } from './director/director.client.js';
import { NowplayingClient } from './nowplaying/nowplaying.client.js';
import { OnboardingClient } from './onboarding/onboarding.client.js';
import { PersonasClient } from './personas/personas.client.js';
import { PlaylistsClient } from './playlists/playlists.client.js';
import { PlayoutClient } from './playout/playout.client.js';
import { PluginsClient } from './plugins/plugins.client.js';
import { RenderClient } from './render/render.client.js';
import { SettingsClient } from './settings/settings.client.js';

export class DeadairSdk {
    readonly activity: ActivityClient;
    readonly art: ArtClient;
    readonly authentication: AuthenticationClient;
    readonly catalog: CatalogClient;
    readonly charts: ChartsClient;
    readonly director: DirectorClient;
    readonly nowplaying: NowplayingClient;
    readonly onboarding: OnboardingClient;
    readonly personas: PersonasClient;
    readonly playlists: PlaylistsClient;
    readonly playout: PlayoutClient;
    readonly plugins: PluginsClient;
    readonly render: RenderClient;
    readonly settings: SettingsClient;

    constructor(options: SdkOptions) {
        const sdkFetch = options.fetch ?? createSdkFetch(options);
        this.activity = new ActivityClient(sdkFetch);
        this.art = new ArtClient(sdkFetch);
        this.authentication = new AuthenticationClient(sdkFetch);
        this.catalog = new CatalogClient(sdkFetch);
        this.charts = new ChartsClient(sdkFetch);
        this.director = new DirectorClient(sdkFetch);
        this.nowplaying = new NowplayingClient(sdkFetch);
        this.onboarding = new OnboardingClient(sdkFetch);
        this.personas = new PersonasClient(sdkFetch);
        this.playlists = new PlaylistsClient(sdkFetch);
        this.playout = new PlayoutClient(sdkFetch);
        this.plugins = new PluginsClient(sdkFetch);
        this.render = new RenderClient(sdkFetch);
        this.settings = new SettingsClient(sdkFetch);
    }
}
