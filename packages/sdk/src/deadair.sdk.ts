import type { SdkOptions } from './sdk-options.js';
import { createSdkFetch } from './sdk-options.js';
import { AuthenticationClient } from './authentication/authentication.client.js';
import { MusicClient } from './music/music.client.js';
import { OnboardingClient } from './onboarding/onboarding.client.js';
import { PlaylistsClient } from './playlists/playlists.client.js';
import { PluginsClient } from './plugins/plugins.client.js';

export class DeadairSdk {
    readonly authentication: AuthenticationClient;
    readonly music: MusicClient;
    readonly onboarding: OnboardingClient;
    readonly playlists: PlaylistsClient;
    readonly plugins: PluginsClient;

    constructor(options: SdkOptions) {
        const sdkFetch = options.fetch ?? createSdkFetch(options);
        this.authentication = new AuthenticationClient(sdkFetch);
        this.music = new MusicClient(sdkFetch);
        this.onboarding = new OnboardingClient(sdkFetch);
        this.playlists = new PlaylistsClient(sdkFetch);
        this.plugins = new PluginsClient(sdkFetch);
    }
}
