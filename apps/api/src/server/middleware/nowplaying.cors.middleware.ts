import type { ServerKitMiddleware } from '@maroonedsoftware/koa';

/** The one deliberately public route (`nowplaying.ck`), as the app sees it once nginx has taken `/api` off. */
export const NOW_PLAYING_PATH = '/nowplaying';

/**
 * What is on air is PUBLIC, so any page may read it.
 *
 * `GET /nowplaying` answers without a session because a player, a hi-fi streamer or a station page
 * has to be able to ask what is on air (`nowplaying.ck`). A page on another origin could not read the
 * answer all the same: the credentialed allowlist in `setup.middleware` names only the console's
 * origins, so the browser refused a `fetch` from anywhere else. The first page that needed it is the
 * community directory at deadair.radio, which shows what each listed station is playing; any
 * listener's own widget is the same case.
 *
 * Everything else about it is `hls.cors.middleware.ts`, for the same reasons, which that file argues
 * in full: a wildcard cannot join a credentialed allowlist, so this OVERRIDES the global answer for
 * this one path on the way out, and it strips `Access-Control-Allow-Credentials`, which a browser
 * refuses beside `*`. The route reads no cookie and no bearer, so a credentialed request would have
 * gained nothing from the old answer anyway.
 *
 * No preflight branch either: a reader sends a plain `GET`, at most with an `Accept` header, which is
 * one the browser never preflights.
 *
 * Exactly this path, not a prefix. What the answer says is already public by design (the station's
 * name, what is playing, the mounts, and a listener count Icecast's own status document publishes),
 * and that is the argument for opening it; a route added under it later has not made that argument.
 */
export const nowPlayingCorsMiddleware = (): ServerKitMiddleware => async (ctx, next) => {
    const isNowPlaying = ctx.path === NOW_PLAYING_PATH;

    await next();

    if (!isNowPlaying) return;

    ctx.set('Access-Control-Allow-Origin', '*');
    ctx.remove('Access-Control-Allow-Credentials');
};
