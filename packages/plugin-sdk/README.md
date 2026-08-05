# @deadair/plugin-sdk

Everything you need to write a deadair plugin, and nothing else. This package
is the only thing a plugin imports from deadair: no database, no DI container,
no HTTP framework. Its single runtime dependency is `zod`, and that is a peer
dependency so you and the host share one copy.

A plugin extends deadair in one of two ways today:

| kind             | what it does                                                    |
| ---------------- | --------------------------------------------------------------- |
| `music-provider` | supplies music: search, browse, and optionally play it           |
| `enrichment`     | supplies facts about a track: year, genre, label, trivia, links  |

## The shape of a plugin

A plugin package default-exports the result of `definePlugin(manifest, factory)`
and points at that entry file from its own `package.json`:

```json
{
    "name": "deadair-plugin-discogs",
    "version": "1.0.0",
    "type": "module",
    "main": "./dist/index.js",
    "deadair": {
        "plugin": "./dist/index.js"
    },
    "peerDependencies": {
        "@deadair/plugin-sdk": "^0.0.1",
        "zod": "^4.0.0"
    }
}
```

The `deadair.plugin` field is how the host finds your entry point. Without it,
your package is just a package.

## The rules

1. **No ambient I/O.** Get at the world through the `PluginHost` handed to
   `init()`. `host.fetch()` is your egress, and it will refuse any hostname you
   did not declare in `permissions.network`.

   This is a rule, not a cage. The host imports you into its own process today,
   so global `fetch` and `fs` are technically within reach. Use them and you
   opt out of the rate limiting, timeouts, redirect checks, and audit logging
   the host does on your behalf, you make your manifest a lie to the operator
   who installed you, and you break the day plugins move into an isolate.
2. **Everything crossing the boundary is JSON-safe.** No `Date`, no `Response`,
   no class instances, no functions in payloads. Durations are integers in
   milliseconds; dates are ISO-8601 strings. The host runs plugins in-process
   today and may move them behind a subprocess tomorrow, and your code should
   not notice. That target is a subprocess over IPC rather than
   `worker_threads`, which is why the rule is JSON-safe and not merely
   structured-clone-safe: a `Uint8Array` would survive a `worker_threads` move
   but not a subprocess one.
3. **Ask for what you need and no more.** `permissions` is shown to the
   operator before they install you.
4. **`undefined`, never `null`,** for "not set".
5. **Do no work in the factory.** Build the object, put setup in `init()`, and
   undo it in `dispose()`.
6. **Secrets are write-only.** A `secret` config field is encrypted at rest and
   never read back into the settings UI. Read it with `host.secrets.get()`.

## A complete minimal plugin

An enrichment plugin that looks a track up by ISRC and returns its release
year and genres.

```ts
import {
    definePlugin,
    type EnrichmentPluginInstance,
    jsonBody,
    type PluginHost,
    type PluginManifest,
    type TrackEnrichment,
    type TrackRef,
} from '@deadair/plugin-sdk';
import { z } from 'zod';

const configSchema = z.object({
    apiKey: z.string().min(1),
    includeGenres: z.boolean().default(true),
});

const manifest: PluginManifest = {
    id: 'example.recordbin',
    name: 'Record Bin',
    version: '1.0.0',
    kind: 'enrichment',
    capabilities: ['enrichment'],
    apiVersion: '^1.0.0',
    description: 'Release years and genres from the Record Bin catalogue.',
    homepage: 'https://example.com/recordbin',
    permissions: {
        network: ['api.recordbin.example.com'],
        storage: false,
        oauth: false,
    },
    configFields: [
        {
            key: 'apiKey',
            label: 'API key',
            type: 'secret',
            required: true,
            help: 'Create one under Account → Developers.',
        },
        {
            key: 'includeGenres',
            label: 'Include genres',
            type: 'boolean',
            default: true,
        },
    ],
    configSchema,
};

class RecordBinPlugin implements EnrichmentPluginInstance {
    priority = 500;
    matchKeys: EnrichmentPluginInstance['matchKeys'] = ['isrc'];

    private host?: PluginHost;
    private apiKey?: string;
    private includeGenres = true;

    async init(host: PluginHost): Promise<void> {
        this.host = host;
        this.apiKey = await host.secrets.get('apiKey');
        const config = await host.config.get();
        this.includeGenres = config.includeGenres !== false;
        host.logger.info('record bin ready');
    }

    async testConnection(): Promise<{ ok: boolean; message?: string }> {
        const response = await this.request('/health');
        return response.ok ? { ok: true, message: 'Connected.' } : { ok: false, message: `HTTP ${response.status}` };
    }

    async enrichTrack(ref: TrackRef): Promise<Partial<TrackEnrichment>> {
        if (!ref.isrc) return {};

        const response = await this.request(`/recordings/${encodeURIComponent(ref.isrc)}`);
        if (!response.ok) {
            this.host?.logger.warn('lookup failed', { isrc: ref.isrc, status: response.status });
            return {};
        }

        const body = jsonBody<{ year?: number; genres?: string[]; label?: string }>(response);

        return {
            year: body.year,
            label: body.label,
            genres: this.includeGenres ? body.genres : undefined,
            links: [{ label: 'Record Bin', url: `https://example.com/recordbin/${ref.isrc}` }],
        };
    }

    async dispose(): Promise<void> {
        this.host = undefined;
    }

    private async request(path: string) {
        if (!this.host) throw new Error('init() was never called');
        return this.host.fetch(`https://api.recordbin.example.com${path}`, {
            headers: { authorization: `Bearer ${this.apiKey ?? ''}` },
            timeoutMs: 5_000,
        });
    }
}

export default definePlugin(manifest, () => new RecordBinPlugin());
```

## What `host.fetch` gives back

A `HostFetchResponse` is a POJO, not a `Response`, per rule 2. Most of it maps
one-for-one; the parts that do not:

- **`body` is always a string, always whole.** The host buffers it under the
  request's deadline and under a size cap, so an oversized response fails the
  call rather than arriving truncated. There is no streaming and no binary: a
  body that is not UTF-8 text will not survive.
- **`setCookie` is a separate array.** `headers` is a `Record`, which can only
  hold one value per name, and `Set-Cookie` is the header servers routinely
  repeat. It is absent from `headers` entirely so there is no half-truth to
  read. Other repeated headers arrive joined with `", "`.
- **`url` is where the response came from,** the last hop of the redirect
  chain, which is not necessarily what you asked for. `redirected` tells you
  whether it moved.

`jsonBody(response)` parses the body and throws with the status, the URL and
the start of the body when it will not parse, which beats
`Unexpected token < in JSON at position 0` when an API answers a 200 with an
HTML error page. `tryJsonBody(response)` returns `undefined` instead of
throwing. Both are ordinary functions rather than methods on the response,
because a method would make the payload itself unserializable.

The host sets a `User-Agent` for you (`<your plugin id>/<version> (deadair)`)
when you do not set one yourself, because a number of APIs refuse the default
one Node sends. Set the header yourself when the upstream's policy asks for
more than that: MusicBrainz wants a contact address, which usually means a
`contact` config field the operator fills in. Yours always wins.

An upstream that answers is not a failure: a 404 or a 500 comes back as an
ordinary `HostFetchResponse` with `ok: false`, and what it means is yours to
decide. `host.fetch` only *rejects* when there is no response to give you, and
when it does it rejects with a `PluginError` carrying the same
[`PluginErrorCode`](src/plugin.error.ts) vocabulary your own failures use, so
you can branch on it:

- `upstream` — the request never completed, or the server misbehaved (an
  unreachable host, a redirect chain past the cap, a redirect somewhere your
  manifest does not allow, a body over the size cap).
- `timeout` — the host abandoned the call at its deadline.
- `rate_limited` — you are over the host's fetch quota by more time than the
  call had left. `retryAfterMs` says how long the wait would have been.
- `forbidden` — the hostname is not in your `permissions.network`.
- `config` — the URL did not parse, or was not http(s). Usually an operator
  setting you built it from.

Let these propagate unless you can do something better with them. The host
maps each one to a status and error code for the operator console, and
swallowing them turns a precise answer into a silent empty result.

## Declaring the upstreams you reach

`permissions.network` is a list of bare hostnames, and a leading `*.` is a
wildcard subdomain that does not match the apex:

```ts
network: ['api.spotify.com', 'accounts.spotify.com']
```

Use the object form when the upstream publishes a rate limit. `host.fetch`
then paces you at it, parking each call until there is headroom instead of
failing it, and you write no pacer at all:

```ts
network: [
    { host: 'musicbrainz.org', ratePerSecond: 1, bucket: 'musicbrainz' },
    { host: '*.musicbrainz.org', ratePerSecond: 1, bucket: 'musicbrainz' },
    'coverartarchive.org',
]
```

`bucket` is what makes those first two entries share one allowance. Published
limits are usually per service rather than per hostname, and two entries
without a shared bucket are two allowances, which is how a plugin ends up at
twice the rate it declared and the station gets blocked. Entries with different
buckets never pace each other, so a slow upstream does not hold up a fast one.

When the operator picks the address (a mirror, a self-hosted server), name the
config field it lives in instead of a hostname:

```ts
configFields: [{ key: 'baseUrl', label: 'Server URL', type: 'url' }],
permissions: {
    network: [
        { host: 'musicbrainz.org', ratePerSecond: 1, bucket: 'musicbrainz' },
        { fromConfig: 'baseUrl', ratePerSecond: 10 },
    ],
    ...
}
```

The host reads the hostname out of that setting when your plugin is
initialized, so changing it takes effect on the reinitialization the save
triggers. A setting that is blank or unparseable contributes no entry, so an
unconfigured plugin is refused exactly as if the host were undeclared, and a
wildcard is never accepted from a setting: those come only from a manifest an
operator could read before installing.

Order it after the hostname you know, as above. First match wins, so an
operator who points `baseUrl` back at the canonical service still gets the
strict rate rather than the mirror's.

The rate is a floor on the interval, not a promise of throughput: the host caps
every bucket at its own ceiling, so asking to go faster than the host allows
does nothing. Parking is spent from the call's budget, which is the other half
of this: see below.

## Knowing how much time you have

Every call into your code has a deadline, and it is not a constant: a
background job may run on a far longer budget than a request someone is waiting
on, and the same method of yours gets called both ways. `host.remainingMs()`
tells you what is left of the current one.

Reach for it when the work is a sequence whose later steps are optional, which
is the usual shape for anything paced against a rate-limited API:

```ts
const core = await this.lookup(ref);
if ((await host.remainingMs()) < 2_000) return core;  // good enough, out of time
return { ...core, ...(await this.enrich(core)) };
```

What it saves you from is hardcoding a guess at the host's deadline, which
means either quitting early on a budget you actually had or being killed
halfway through with nothing to return.

It is the host's clock, not an allowance: everything the call does spends from
it, including the time `host.fetch` parks waiting for rate-limit headroom, and
`host.fetch` caps its own timeout by it. Read a small number as advice to wrap
up, not as permission to run that long.

## Music providers

A `music-provider` declares any subset of three sub-capabilities and lists the
ones it implements in `manifest.capabilities`:

- **`catalog`** — `searchTracks`, `getTrack`, `listPlaylists`,
  `getPlaylistTracks`, and optionally `resolveStreamUrl` and
  `getSessionCredentials`. Implement
  `resolveStreamUrl` when you can hand the host a playable URL that the audio
  consumer can fetch directly; omit it and implement `playout` instead when
  your provider plays audio itself and only takes instructions. A byte-level
  streaming protocol for the rare case where no such URL can be minted is
  specified in `docs/decisions/plugin-streaming.md`, but it is not implemented
  and there is no `host.streams` to call.

  `getSessionCredentials` covers a third, narrower case: the audio is
  reachable, but only to a process speaking a protocol the plugin does not, so
  a station-side helper opens its own session with the provider. It returns a
  `{ username, accessToken }` the helper logs in with, while the plugin keeps
  the account and the token refresh. Spotify is the reason it exists — its
  tracks come off the CDN encrypted and are fetched by a separate binary beside
  Liquidsoap. **Do not implement it to hand out credentials for an ordinary
  HTTP fetch**: mint a URL in `resolveStreamUrl` instead and keep the
  credentials inside the plugin, which is both simpler and narrower.
- **`playout`** — `enqueue`, `play`, `pause`, `skip`, `getPlaybackState`. This
  is the "steer" half: the provider owns the audio output.
- **`oauth`** — `getAuthorizeUrl(state)` and `handleCallback(params)`. The host
  owns the redirect endpoint (`host.oauth.getRedirectUri()`) and the token
  vault (`saveTokens` / `getTokens`); you only build the authorize URL and
  exchange the code.

```ts
import { definePlugin, type MusicProviderPluginInstance, type ProviderTrack } from '@deadair/plugin-sdk';

class LibraryPlugin implements MusicProviderPluginInstance {
    async init(): Promise<void> {}

    async searchTracks(query: string): Promise<ProviderTrack[]> {
        // ...
        return [];
    }
}
```

## Configuration fields

`configFields` is a declarative form description. The host renders it; plugins
never ship UI.

| type      | notes                                                             |
| --------- | ----------------------------------------------------------------- |
| `string`  | free text                                                          |
| `url`     | free text, validated as a URL                                      |
| `secret`  | write-only, encrypted, read via `host.secrets.get()`               |
| `number`  | numeric input                                                      |
| `boolean` | toggle                                                             |
| `select`  | one of `options`                                                   |
| `note`    | not an input; static help text in the form                         |

Use `dependsOn` to hide a field until another one is filled in. Use
`configSchema` for anything the form cannot express: the host parses the
operator's submission with it before storing, so by the time `init()` runs
your config is already valid.

## Versioning

`PLUGIN_API_VERSION` is the API version this SDK implements. Your manifest's
`apiVersion` is a semver **range** (`^1.0.0`), and the host refuses to load a
plugin whose range does not cover its own version.
