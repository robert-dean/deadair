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

## Music providers

A `music-provider` declares any subset of three sub-capabilities and lists the
ones it implements in `manifest.capabilities`:

- **`catalog`** — `searchTracks`, `getTrack`, `listPlaylists`,
  `getPlaylistTracks`, and optionally `resolveStreamUrl`. Implement
  `resolveStreamUrl` when you can hand the host a playable URL that the audio
  consumer can fetch directly; omit it and implement `playout` instead when
  your provider plays audio itself and only takes instructions. A byte-level
  streaming protocol for the rare case where no such URL can be minted is
  specified in `docs/decisions/plugin-streaming.md`, but it is not implemented
  and there is no `host.streams` to call.
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
