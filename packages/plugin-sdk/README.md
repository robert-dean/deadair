# @deadair/plugin-sdk

Everything you need to write a deadair plugin, and nothing else. This package
is the only thing a plugin imports from deadair: no database, no DI container,
no HTTP framework. Its single runtime dependency is `zod`, and that is a peer
dependency so you and the host share one copy.

A plugin extends deadair by declaring capabilities:

| capability   | what it lets you do                                            |
| ------------ | -------------------------------------------------------------- |
| `catalog`    | supply music: list playlists, list their tracks                |
| `stream`     | get the station the audio to play (`resolveStreamUrl`)         |
| `steer`      | own your audio output and let deadair only tell you what to do |
| `enrichment` | supply facts about a track: year, genre, label, trivia, prose  |
| `speech`     | say something out loud: text in, audio out                     |
| `llm`        | produce words: a conversation in, text out                     |
| `analysis`   | measure a track's audio: bytes in, cue points and loudness out  |
| `mixer`      | make one piece of audio out of several: parts in, audio out    |
| `charts`     | say what is popular: a chart id in, ranked names out           |
| `similarity` | say who else sounds like this: an artist in, artists out       |
| `news`       | say what happened outside the station: a feed in, entries out  |
| `search`     | ask the open web a question: words in, pages out               |
| `weather`    | say what it is like outside: a place in, measurements out       |
| `scrobble`   | report what the station played to somebody else's service      |
| `oauth`      | hold operator tokens, obtained through the host's redirect     |

There is no second axis. `capabilities` is the whole declaration, and the host
checks it on every call together with whether you actually implemented the
methods, because a plugin that claims a capability and forgets the method is a
`TypeError` in the middle of a request rather than an honest "not supported".

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

1. **No ambient I/O.** Get at the world through the `PluginHost`. `host.fetch()`
   is your egress, and it will refuse any hostname you did not declare in
   `permissions.network`.

    This is a rule, not a cage, and it is never going to be one. The host
    imports you into its own process, permanently, so global `fetch` and `fs`
    are within reach. Use them and you opt out of the rate limiting, timeouts,
    redirect checks and audit logging the host does on your behalf, and you make
    your manifest a lie to the operator who installed you.

2. **Payloads that get stored or sent are JSON-safe.** No `Date`, no class
   instances, no functions on anything in `capabilities/`. Durations are
   integers in milliseconds; dates are ISO-8601 strings. Not because the
   boundary is a wire (it is a function call) but because those values end up in
   Postgres and in the console's JSON, and a `Date` comes back out of a `jsonb`
   column as a string either way.

    The host's own methods are under no such rule: `host.fetch` hands you a real
    `Response`, `host.signal` a real `AbortSignal`, and `speak()` returns a real
    `ReadableStream`.

3. **Ask for what you need and no more.** `permissions` is shown to the
   operator before they enable you.
4. **`undefined`, never `null`,** for "not set".
5. **Do no work in the factory.** Build the object, put setup in `onLoad()`, and
   register the undo for anything you start.
6. **Secrets are write-only.** A `secret` config field is encrypted at rest and
   never read back into the settings UI. Read it with `host.secrets.get()`.
7. **A URL you hand back to be stored must be stable.** `artworkUrl` is kept,
   and the host's art cache is keyed by the URL string itself, so the same
   image has to mint the same URL every time you are asked about it. If yours
   carries credentials, fix the varying part — a salt, a nonce, a timestamp —
   once in `init()` and reuse it for art. Vary it per call and every mention
   becomes a new row and another download of identical bytes; nothing errors,
   it just never caches. `resolveStreamUrl` is under no such rule, because
   nothing stores what it returns.

## A complete minimal plugin

An enrichment plugin that looks a track up by ISRC and returns its release
year and genres.

```ts
import {
    definePlugin,
    type EnrichmentPluginInstance,
    jsonBody,
    Plugin,
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

class RecordBinPlugin extends Plugin implements EnrichmentPluginInstance {
    priority = 500;
    matchKeys: EnrichmentPluginInstance['matchKeys'] = ['isrc'];

    private apiKey?: string;
    private includeGenres = true;

    protected async onLoad(): Promise<void> {
        this.apiKey = await this.host.secrets.get('apiKey');
        const config = await this.host.config.get();
        this.includeGenres = config.includeGenres !== false;
        this.host.logger.info('record bin ready');
    }

    async testConnection(): Promise<{ ok: boolean; message?: string }> {
        const response = await this.request('/health');
        return response.ok ? { ok: true, message: 'Connected.' } : { ok: false, message: `HTTP ${response.status}` };
    }

    async enrichTrack(ref: TrackRef): Promise<Partial<TrackEnrichment>> {
        if (!ref.isrc) return {};

        const response = await this.request(`/recordings/${encodeURIComponent(ref.isrc)}`);
        if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            this.host.logger.warn('lookup failed', { isrc: ref.isrc, status: response.status });
            return {};
        }

        const body = await jsonBody<{ year?: number; genres?: string[]; label?: string }>(response);

        return {
            year: body.year,
            label: body.label,
            genres: this.includeGenres ? body.genres : undefined,
            links: [{ label: 'Record Bin', url: `https://example.com/recordbin/${ref.isrc}` }],
        };
    }

    private async request(path: string): Promise<Response> {
        return await this.host.fetch(`https://api.recordbin.example.com${path}`, {
            headers: { authorization: `Bearer ${this.apiKey ?? ''}` },
            timeoutMs: 5_000,
        });
    }
}

export default definePlugin(manifest, () => new RecordBinPlugin());
```

## What `host.fetch` gives back

A real `Response`. Not a copy, not a POJO: `await response.json()` is how you
read JSON, `response.body` is how you stream audio, and you can hand it to any
library that takes one. That is what lets the Spotify SDK's `fetch` hook be
wired straight through instead of adapted in both directions.

Two things about it are the host's doing rather than the platform's, and both
are part of the contract:

- **`url` is the last hop of the redirect chain,** not necessarily what you
  asked for, so relative links in the body resolve against it. `redirected`
  tells you whether it moved. The host follows redirects by hand to re-check
  your allowlist on every hop, so it sets both itself.
- **The body is bounded.** `timeoutMs` covers getting the response (connect,
  headers, the whole redirect chain) and stops there, because a large body
  legitimately outlives the call that asked for it. Reading it is bounded
  separately by an idle deadline between chunks, a total byte cap and a lifetime
  cap. Exceeding any of them fails the read rather than truncating it, so bytes
  you get are always bytes the server sent.

**A body you are not going to read is one you should `cancel()`.** The host
force-cancels whatever you still hold when your plugin is disposed, and the
lifetime cap catches the rest, but neither is prompt. On an error path, let it
go yourself:

```ts
if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new PluginError(`upstream said ${response.status}`).withCode('upstream');
}
```

`jsonBody(response)` parses the body and throws with the status, the URL and the
start of the body when it will not parse, which beats
`Unexpected token < in JSON at position 0` when an API answers a 200 with an
HTML error page. `tryJsonBody(response)` returns `undefined` instead of
throwing. Both are `async`, and both are ordinary functions rather than methods,
so the response you hold stays the platform's own.

The host sets a `User-Agent` for you (`<your plugin id>/<version> (deadair)`)
when you do not set one yourself, because a number of APIs refuse the default
one Node sends. Set the header yourself when the upstream's policy asks for
more than that: MusicBrainz wants a contact address, which usually means a
`contact` config field the operator fills in. Yours always wins.

An upstream that answers is not a failure: a 404 or a 500 comes back as an
ordinary `Response` with `ok: false`, and what it means is yours to decide.
`host.fetch` only _rejects_ when there is no response to give you, and when it
does it rejects with a `PluginError` carrying the same
[`PluginErrorCode`](src/plugin.error.ts) vocabulary your own failures use, so
you can branch on it:

- `upstream` — the request never completed, or the server misbehaved (an
  unreachable host, a redirect chain past the cap, a redirect somewhere your
  manifest does not allow, a body over the size cap).
- `timeout` — the host abandoned the call at its deadline, or the body went
  quiet for longer than the idle deadline allows.
- `rate_limited` — you are over the host's fetch quota by more time than the
  call had left. `retryAfterMs` says how long the wait would have been.
- `forbidden` — the hostname is not in your `permissions.network`.
- `config` — the URL did not parse, or was not http(s). Usually an operator
  setting you built it from.

The body's own failures arrive the same way, on the read rather than on the
fetch, because that is when they happen.

Let these propagate unless you can do something better with them. The host
maps each one to a status and error code for the operator console, and
swallowing them turns a precise answer into a silent empty result.

## When the body should not arrive whole

Nothing special. `response.body` is a `ReadableStream<Uint8Array>` and you read
it, or pass it on, or pipe it through something:

```ts
const response = await host.fetch(`${this.baseUrl}/audio/speech`, { method: 'POST', body });
if (!response.ok || response.body === null) {
    await response.body?.cancel().catch(() => {});
    throw new PluginError(`engine said ${response.status}`).withCode('upstream');
}

return { mime: 'audio/mpeg', audio: response.body };
```

There was once a second egress here, `host.streams`, with handles, sequence
numbers, base64 chunks and an idempotent `close()`, because a live object could
not cross the boundary. All of it is gone: a `ReadableStream` is already a
pull-based stream with backpressure and a cancel, and the boundary is a function
call. See `docs/decisions/plugin-trust.md`.

What survives is the bounds, and they are the reason it was ever thought about:
a body is read outside the deadline that fetched it, so an idle deadline, a
lifetime cap and a byte cap are what stop it being an unbounded socket.

## Declaring the upstreams you reach

`permissions.network` is a list of bare hostnames, and a leading `*.` is a
wildcard subdomain that does not match the apex:

```ts
network: ['api.spotify.com', 'accounts.spotify.com'];
```

Use the object form when the upstream publishes a rate limit. `host.fetch`
then paces you at it, parking each call until there is headroom instead of
failing it, and you write no pacer at all:

```ts
network: [
    { host: 'musicbrainz.org', ratePerSecond: 1, bucket: 'musicbrainz' },
    { host: '*.musicbrainz.org', ratePerSecond: 1, bucket: 'musicbrainz' },
    'coverartarchive.org',
];
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

A setting holding SEVERAL addresses contributes one entry each, which is how a
plugin pointed at a list the operator pasted — a reader of feeds — declares
upstreams it cannot know at authoring time. One address per line (a `text`
field), or the JSON array a `multiselect` stores, and where a line carries more
than the address the address is its last `|`-separated field:

```ts
configFields: [{ key: 'feeds', label: 'Feeds', type: 'text' }],
permissions: {
    network: [{ fromConfig: 'feeds', ratePerSecond: 1, bucket: 'rss' }],
    ...
}
```

```
https://example.com/rss.xml
world|World news|https://example.com/world.xml
```

Every rule above is applied per address rather than to the value as a whole, so
one mistyped line costs its own upstream and not the rest. Repeats collapse into
one entry, or two feeds at one publisher would install a second limiter and
quietly double the rate you asked to be paced at. A shared `bucket` is usually
right here, because what is being paced is your own outbound rate rather than
any one publisher's published limit.

The rate is a floor on the interval, not a promise of throughput: the host caps
every bucket at its own ceiling, so asking to go faster than the host allows
does nothing. Parking is spent from the call's budget, which is the other half
of this: see below.

## Knowing how much time you have

Every call into your code has a deadline, and it is not a constant: a
background job may run on a far longer budget than a request someone is waiting
on, and the same method of yours gets called both ways. Two things tell you
about it, and they answer different questions.

`host.signal` is an `AbortSignal` that fires when the host gives up on the call.
It is the host's own signal, not a copy, so honouring it and being abandoned are
the same moment rather than two clocks that nearly agree. `host.fetch` watches
it for you; pass it on to anything else of yours that takes one. Outside any
host call (from a timer you set yourself) it is a signal that never aborts,
because nothing is waiting on that work.

`host.remainingMs()` is the number behind it, for deciding whether to START
something rather than for being interrupted during it. Reach for it when the
work is a sequence whose later steps are optional, which is the usual shape for
anything paced against a rate-limited API:

```ts
const core = await this.lookup(ref);
if (host.remainingMs() < 2_000) return core; // good enough, out of time
return { ...core, ...(await this.enrich(core)) };
```

What it saves you from is hardcoding a guess at the host's deadline, which
means either quitting early on a budget you actually had or being killed
halfway through with nothing to return.

It is the host's clock, not an allowance: everything the call does spends from
it, including the time `host.fetch` parks waiting for rate-limit headroom, and
`host.fetch` caps its own timeout by it. Read a small number as advice to wrap
up, not as permission to run that long.

## When your audio needs a helper to fetch it

Almost every provider answers `resolveStreamUrl` out of its own head: it knows a
URL, it signs one, it hands it back. `host.trackFetcher` is for the one shape
that cannot — audio that is reachable, but only to a process speaking a protocol
you do not.

Spotify is the case it exists for. Its tracks come off the CDN encrypted, so
there is no URL to mint at all; a separate binary runs beside the audio player,
speaks Spotify's own protocol, and re-serves the track as plain audio over HTTP.
You lend it a login, and get back the URL you were going to return anyway:

```ts
async resolveStreamUrl(trackId: string): Promise<ProviderStream | undefined> {
    const session = await this.currentSession();          // your account, your refresh
    if (!session) return undefined;                       // not connected yet

    return host.trackFetcher.serve({ trackId, session });
}
```

The login goes to the fetcher and nowhere else: it is not stored, not written to
config, and not readable back out of the host. `serve` resolves to `undefined`
when the operator's station has no fetcher configured, which you pass straight
through — an item nobody can resolve is skipped, not an error.

Requires the `trackFetcher` permission. **Do not reach for it when your audio can
simply be fetched.** Mint the URL yourself and keep your credentials to yourself,
which is both simpler and narrower.

## Enriching artists and albums, not just tracks

`enrichTrack` is the only method an enrichment plugin must write.
`enrichArtist` and `enrichAlbum` are optional, and worth writing for anything
that belongs to the artist or the record rather than to one recording:

```ts
async enrichArtist(ref: ArtistRef): Promise<Partial<ArtistEnrichment>> {
    // `mbid` is the id that crosses providers; `providerRef` is your own id
    // from the last time you answered about this artist. Both may be absent
    // the first time anything asks, in which case you have a name.
    const id = ref.providerRef ?? (await this.search(ref.name));
    if (!id) return {};

    const body = jsonBody<{ bio?: string; image?: string }>(await this.request(`/artists/${id}`));
    return { providerRef: id, biography: body.bio, imageUrl: body.image, externalIds: [{ source: 'recordbin', id }] };
}
```

The reason to split them is cost, not tidiness. The host asks once per artist
and once per album, so an artist who appears on forty tracks is one request
rather than forty, and the answer is stored against the artist where the
console and the DJ can both read it. Anything you return from `enrichTrack`
is still stored against the track, so a single with no album, or a
compilation whose tracks were licensed separately, is still described
correctly by `TrackEnrichment.label`.

The `providerRef` you return is remembered as the id that answer was fetched
under, and handed back to you — and only to you — as `ref.providerRef` next
time. That is what turns a second pass into a lookup instead of another search,
so state it whenever you have one.

It is deliberately separate from `externalIds`, which answers a different
question: what this thing is called _elsewhere_. List those in whatever order
you like, including ids that are not yours. A local library that reads a
MusicBrainz id out of a file's tags should absolutely report it, and doing so
must not cost it its own ref.

## Facts, and the prose facts are extracted from

`facts` and `documents` are both things to say about a record, and the
difference between them is who wrote the sentence.

A **fact** is a line you composed and are willing to have read out on air
unchanged. Keep them short and independently speakable, because that is what
happens to them: a talk break is shown a couple of them and the DJ works one
in. Compose them only out of things you actually know — a fact assembled from
a field you guessed at is a station saying something untrue in a confident
voice.

A **document** is somebody else's prose, verbatim: an encyclopaedia article, a
song description, a set of sleeve notes. Nothing reads one aloud and nothing
renders one on a page. The host extracts claims from it, checks each claim
against the text it came from, and keeps the citation. So:

```ts
return {
    documents: [{ url: article.url, title: article.title, text: article.extract, retrievedAt: new Date().toISOString() }],
};
```

Three rules make that worth doing.

**Hand over the prose, not your summary of it.** The host stores the document,
so a better extraction later costs your upstream nothing, and a claim's quoted
span has to occur in the text you supplied or the claim is dropped. A summary
you wrote is a span nobody can check.

**Plain text.** Strip the furniture a reader ignores anyway: navigation,
licence footers, reference markers, markup. What is left reaches a language
model, and eventually a mouth.

**`url` is a citation, not a link.** It is the address an operator opens to
check whether the station is telling the truth about a record, so it has to be
somewhere a person can actually read the text you sent. A document whose URL
is not http(s) is dropped whole.

## Searching the open web

A `search` plugin has one method, and the caller supplies the subject:

```ts
async search(query: SearchQuery): Promise<SearchResult[]> {
    const hits = await this.engine.run(query.query, query.limit, query.recency);
    return hits.map(hit => ({ title: hit.title, snippet: plainText(hit.description), url: hit.url, site: hit.profile }));
}
```

Three things about it are easy to get wrong.

**A snippet is plain text.** Search APIs are the worst offenders in the SDK for
this: Brave wraps every matched query term in `<strong>` unless you pass
`text_decorations=0`, and descriptions carry HTML entities either way. Run them
through `plainText` from `html.text.ts`. What is left reaches a language model,
and possibly a mouth.

**There is nowhere to put a synthesized answer, deliberately.** Several engines
sell one — Tavily's `answer`, SearXNG's first infobox — and it is a paragraph
somebody else's model wrote about pages this station never sees. Nothing can
check it against a source, so nothing here can carry it. If your plugin has
prose worth extracting claims from, declare `enrichment` too and return it as a
`documents` entry, where the provenance and the quote check already live.

**An empty array is an answer.** An unconfigured plugin, an engine that is down,
a rate limit and a query nothing matched are one outcome to every caller. Throw
only for something the operator has to go and fix.

Note what `search` is not. Looking for something to PLAY is `searchTracks` on
the catalog capability, which answers with provider ids the station can resolve
into audio. Nothing a search plugin returns can be scheduled.

## Saying what it is like outside

A `weather` plugin has one method, and the caller supplies the place:

```ts
async getWeather(query: WeatherQuery): Promise<WeatherReading | undefined> {
    const point = await this.resolve(query.place);          // your service, your geocoder
    if (point === undefined) return undefined;              // nowhere of that name

    const forecast = await this.forecast(point, query.days ?? 0);
    return { place: point.name, observedAt: forecast.time, current: forecast.now, days: forecast.days };
}
```

Three things about it are easy to get wrong.

**Everything is metric.** Celsius, km/h, and no unit field anywhere. What a
station SAYS is a station's own decision, settled where the words are made,
beside every other decision about how that station talks. A plugin converting
would make the units on the wire depend on which plugin was installed, which is
the one thing a capability must not let happen. It is `ConfigField.unit`'s rule
one layer down.

**You resolve the place, and the host never geocodes.** `query.place` is a name
somebody typed. Turning it into coordinates is exactly the per-service quirk this
boundary exists to absorb — one service ships a geocoder, one takes coordinates
only, one wants its own city ids — and a host that geocoded would have to pick
one service to geocode with. Answer with the place as YOUR service resolved it,
because that is the part a presenter says out loud and the only evidence anybody
has that the right town was found.

**A condition is a closed vocabulary.** `WeatherCondition` is ten arms. WMO code
73, an icon string of `snow` and a numeric condition id are three spellings of
one thing, and mapping them is yours. Your service's own word survives beside it
as `description`, which nothing deterministic reads and a model may use.

`undefined` is an answer, on the same terms as a search plugin's empty array: an
unconfigured plugin, a place nothing could resolve and a service that is down are
one outcome to every caller. Throw only for something the operator must fix.

## Music providers

A `music-provider` declares any subset of four sub-capabilities and lists the
ones it implements in `manifest.capabilities`:

- **`catalog`** — `searchTracks`, `getTrack`, `listPlaylists`,
  `getPlaylistTracks`. Being browsable, and nothing more: a provider that can
  be searched but whose audio deadair cannot get at is a legitimate thing to
  be, and it declares this alone.

    `SearchTracksOptions` carries `genre`, `yearFrom` and `yearTo` beside
    `limit` and `offset`, structured and provider-neutral: the caller's `query`
    is free text going at a title and an artist name, and a style is a
    different axis. Express them however your upstream does — the host never
    learns one service's filter dialect, exactly as it never learns a speech
    engine's knobs.

    **Two rules here are load-bearing, and both are about not lying quietly.**
    A filter you cannot apply means you have nothing to offer for that search,
    so answer `[]`; never ignore it and answer as though it had not been asked
    for, because the caller merges several providers into one list and nothing
    marks which rows honoured it. And `limit` is a TOTAL rather than a page
    size: page internally if your upstream's own ceiling is lower, since a
    short answer is indistinguishable from a genuinely thin search.

- **`stream`** — `resolveStreamUrl`: hand back a complete URL the audio consumer
  can fetch directly, carrying its own authentication, because it is fetched
  with no headers from us. A provider that cannot answer it plays its own audio
  and declares `steer` instead.

    How you get that URL is your business. Most providers mint one out of their
    own head. If your audio is reachable only to a process speaking a protocol you
    do not (Spotify's, whose tracks come off the CDN encrypted) lend the station's
    fetcher a login and return the URL it gives you back; see _When your audio
    needs a helper to fetch it_ above.

    This capability is a URL, not bytes. Audio that reaches the station as bytes
    through Node is the exceptional path and always was, even now that
    `response.body` makes it trivial: the audio consumer is Liquidsoap in a
    sibling container, so a URL it can fetch is zero copies and a stream through
    here is two.

- **`steer`** — `enqueue`, `play`, `pause`, `skip`, `getPlaybackState`. The
  provider owns the audio output and deadair only tells it what to do. Named
  from the plugin's side on purpose: deadair's own `playout` module is the
  opposite end of this, the one that owns the running order.
- **`oauth`** — `getAuthorizeUrl(state)` and `handleCallback(params)`. The host
  owns the redirect endpoint (`host.oauth.getRedirectUri()`) and the token
  vault (`saveTokens` / `getTokens`); you only build the authorize URL and
  exchange the code.

```ts
import { definePlugin, type MusicProviderPluginInstance, Plugin, type ProviderTrack } from '@deadair/plugin-sdk';

class LibraryPlugin extends Plugin implements MusicProviderPluginInstance {
    async searchTracks(query: string): Promise<ProviderTrack[]> {
        // ...
        return [];
    }
}
```

## Speaking

A plugin that declares `speech` turns a line of text into audio. The result is a
stream rather than a value, and the usual implementation is to hand back the
engine's own response body:

```ts
class KokoroPlugin extends Plugin implements SpeechPluginInstance {
    async speak({ text, voice }: SpeechRequest): Promise<SpeechHandle> {
        const response = await this.host.fetch(`${this.baseUrl}/audio/speech`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ input: text, voice: this.voices[voice ?? ''] ?? this.defaultVoice }),
        });

        if (!response.ok || response.body === null) {
            await response.body?.cancel().catch(() => {});
            throw new PluginError(`TTS answered ${response.status}`).withCode('upstream');
        }

        return { mime: 'audio/mpeg', audio: response.body };
    }
}
```

That is the whole thing. The audio is never held whole on either side, the host
reads it or cancels it, and cancelling reaches the socket without this plugin
forwarding anything.

Three things that are easy to get wrong:

- **Let go of a refusal's body.** `speak` throws instead of handing it over, so
  that `cancel()` is the only chance anything has to release it.
- **Check the size at the END, not on the first chunk.** A server can dribble a
  short JSON error out in several pieces, so "was any of that plausibly audio"
  is only answerable once the stream stops. A `TransformStream` that counts and
  throws in `flush` is the shape that fits; failing there fails the render
  loudly instead of storing a click.
- **`mime` is the answer, not the request.** `SpeechRequest.format` is a hint you
  may ignore; what you return in `SpeechHandle.mime` is what the station stores
  and later serves, and both consumers of station audio pick their behaviour from
  that header rather than from the bytes.

### Voices

`SpeechRequest.voice` is an opaque id the operator chose (`host`, `newsreader`).
Map it to whatever your engine takes, out of your own config, and fall back to
your default for an id you do not know — a missing voice is worth a
`logger.warn` and a rendered line, not a silent station.

The host never interprets that string, and that is deliberate. It is what lets
one station voice be a named preset on one engine and a cloned reference clip on
another, so swapping engines does not rewrite every persona. Engine-specific
tuning belongs in your config, not in the request: the host should not be
carrying knobs only one implementation understands.

Implement `listVoices()` if you have more than one, so the console can draw a
list and preview them. It is optional, and a single-voice plugin is a legitimate
thing to be.

Set `SpeechVoice.spec` on each one. It is an opaque token the host does not read
— whatever identifies a RENDERING to you, like `af_heart@0.95` — and its only job
is keying the cached preview at `GET /voices/{id}/sample`. Without it that cache
is keyed on the station voice ID, which is exactly the part that does not change
when the operator remaps it underneath, so a remap serves the old voice back
forever. Leaving it out is safe for an engine whose voices cannot be
reconfigured, and wrong for one whose can.

**A voice map wants a `list` config field**, not a text box with a separator in
it. Declare a column for the station's name and one for your engine's, and
implement `suggestConfigOptions()` to fill the second from whatever the
operator's own server currently reports — published under `"<fieldKey>.<columnKey>"`.
That is the difference between a table somebody can complete and one that
requires knowing your engine's voice ids by heart, and the shipped plugins get it
wrong at your peril: one of them ran with an empty map against a server holding
68 voices for as long as the field was a box. Keep the column `string` rather
than `select` — a cell with choices renders as an autocomplete, so a value your
list cannot enumerate (a blend expression, a clip added a minute ago) stays
typeable.

## Producing words

A plugin that declares `llm` continues a conversation. It is a **transport, not a
writer**: nothing in this capability knows what a break, a show or a running
order is, because deciding what to say is the station's business and the shapes
that need saying keep multiplying.

```ts
class MyModelPlugin extends Plugin implements LlmPluginInstance {
    async generate(request: LlmRequest): Promise<LlmHandle> {
        const stream = streamText({
            model: this.provider(request.model ?? this.defaultModel),
            messages: toProviderMessages(request.messages),
            ...(request.tools === undefined ? {} : { tools: toProviderTools(request.tools) }),
        });

        return {
            text: stream.textStream,
            result: buildResult(stream),
        };
    }
}
```

The words come back as a stream for a stronger reason than memory: the host
serializes generations through one slot and holds it until the words stop
arriving, not until `generate` resolves. On a local model, releasing early lets
two generations overlap and both get slower.

A caller that only wants the answer uses `collectGeneration(handle)`, which
drains the stream and then returns the result. Reaching for `handle.result`
without draining `handle.text` is how a caller waits forever, because an
undrained provider stream applies backpressure.

Four things that are easy to get wrong:

- **`result.text` is the authority, not the chunks.** A plugin that buffers and
  one that forwards are both legal, and only the first would agree with whatever
  a caller concatenated off the stream.
- **Send `reasoning_effort` only when asked.** It means nothing to a plain model
  and a strict OpenAI-compatible server answers 400 rather than ignoring it.
  Absent means send nothing at all.
- **`request.model` overrides your configured one.** A station wants a big model
  for a show and a small one for a station ident, and one plugin holds exactly
  one config row, so the choice has to travel with the call.
- **Refuse tools you cannot do.** Throw `unsupported` rather than dropping them:
  a break written without the facts a tool would have supplied is worse than one
  that fell back to the deterministic writer.
- **A plugin holding several backends qualifies its ids.** `LlmModelInfo.id` is what comes back as
  `LlmRequest.model`, so it has to be enough to route on: two backends ship models with similar
  names, and the host does not inspect the string. Mark exactly one entry `default: true`, whichever
  one an unnamed request will actually reach. If the backends are rows an operator adds, a `secret`
  column keeps each credential in its own row — see **Rows, and a credential inside one**.
- **Carry back what the provider signed.** Put it in `LlmResult.providerState`
  and the host quotes it verbatim onto the `assistant` turn it builds, as
  `LlmMessage.providerState`, without ever reading it. Some providers refuse a
  tool round trip whose earlier turns arrive stripped of their own thinking
  blocks or call signatures, and that is a fact about a wire protocol rather than
  about a conversation. Leave it unset if yours signs nothing, which most do.

### Tools

`LlmRequest.tools` are **declarations**, and what comes back in
`LlmResult.toolCalls` is **data**. The host runs the tool and sends the result
back as another message; nothing executable crosses this boundary in either
direction, which is why every shape here except `LlmHandle` is JSON-safe.

When you replay a conversation, an `assistant` turn that asked for a tool must
carry its `toolCalls`, and the `tool` turn answering it must carry the matching
`toolCallId`. A model that cannot see its own call has no idea what the message
after it is answering.

Implement `listModels()` if you want tools to work at all. Tool support is a
property of the **model**, not the server — one endpoint commonly serves both a
model that can call tools and one that cannot — so the host reads
`LlmModelInfo.tools` to decide whether it may send any. With no `listModels`, it
has no way to learn that and sends none.

Mark one entry `default: true`. A request that names no model gets yours, and
without the mark the host cannot tell which of your models that is: it has to
assume the least capable one, so a server with a dozen installed never gets sent
tools at all.

Two things worth separating when you write it. **Which models exist is usually
discoverable** — ask the server, rather than making an operator type out what the
machine already knows. **Which of them accept tools is not**, and no endpoint
reports it, so that part has to be config. Getting this backwards produces a
setup loop with no way in: an operator cannot name a model before they can reach
the server, and cannot test the server before they have saved it. Let the address
be saved on its own, and say the model names in `testConnection` — for many
plugins it is the only place an operator can learn them.

## Decoded audio

`analysis` and `mixer` are the two capabilities that need decoded PCM, which is
the one thing that does not happen inside deadair. The expected shape for both is
an adapter over a separate program — the bundled one is an HTTP sidecar serving
both — in the same relationship a speech plugin has with its engine.

### Measuring, and joining

`analyzeTrack(ref)` is what `analysis` requires: bytes in, cue points and
loudness out. Two fields in the answer are not measurements and both matter.
`schemaVersion`
is what YOU produced rather than the constant this package exports, because an
adapter is reporting the analyzer's version and the two drift across an upgrade.
`complete` says whether the whole file was measured, and the host cannot check
it: a truncated download measures perfectly confidently and the specific lie it
tells is that a record which fades ended cold. Always answering `true` disables
the check silently.

`join(request)` is what `mixer` requires: several URLs and a gap in, one piece of
audio out, as a `mime` and a stream. Trim each part to its own cue points unless
told not to, and put the silence BETWEEN the parts and never at the ends — what
you are making is one item in somebody's running order. Answer `unsupported`
rather than failing where the thing behind you cannot join what it was given; a
station that asks has somewhere to go, since a programme whose parts were not
joined simply airs as its parts.

### Why these are two capabilities and can still be one plugin

Joining is the same requirement seen from the other end: whatever decodes for you
can almost certainly concatenate. So declare both and serve them off one address,
which is what the bundled adapter does — splitting it would be two config rows
for one process, free to drift apart.

They are two capabilities all the same, because **the host picks one plugin per
capability**. Carried on `analysis` as an optional method, the station's joiner
was whichever plugin the operator chose to MEASURE with: install one that
measures better and cannot join, name it, and joining stops with nothing to do
about it but choose a worse analyzer. Two keys (`analysis.pluginId` and
`render.mixerPluginId`) let a station measure with one engine and join with
another, and let a mix-only plugin exist at all.

Declaring several capabilities is ordinary here rather than a compromise: the
bundled music providers declare three and four.

## Configuration fields

`configFields` is a declarative form description. The host renders it; plugins
never ship UI.

| type          | notes                                                       |
| ------------- | ----------------------------------------------------------- |
| `string`      | free text                                                   |
| `text`        | free text over several lines                                |
| `url`         | free text, validated as a URL                               |
| `secret`      | write-only, encrypted, read via `host.secrets.get()`        |
| `number`      | numeric input, bounded by `min` / `max` if declared         |
| `boolean`     | toggle                                                      |
| `select`      | one of `options`                                            |
| `multiselect` | any number of `options`, stored as a JSON array             |
| `list`        | any number of rows over `columns`; read with `parseRows()`  |
| `note`        | not an input; static help text in the form                  |

Use `dependsOn` to hide a field until another one is filled in. Use `min` and
`max` on a `number` to say what it will take, which the form bounds the input to.
Use `configSchema` for anything the form cannot express: the host parses the
operator's submission with it before storing, so by the time `onLoad()` runs your
config is already valid. Read a `multiselect` back with
`parseMultiSelect(config.myField)`.

### Rows, and a credential inside one

A `list` is a table the operator adds rows to, declared with `columns` and stored
as a JSON array of objects. A column is `string`, `url`, `select` or `secret`.

```ts
{ key: 'providers', label: 'Providers', type: 'list', columns: [
    { key: 'name', label: 'Name', type: 'string', required: true },
    { key: 'baseUrl', label: 'Address', type: 'url' },
    { key: 'apiKey', label: 'API key', type: 'secret' },
]}
```

A `secret` cell behaves exactly as a `secret` field does and for the same reasons:
the console never shows it, the API never returns it, and it is encrypted on its
own. **It is not in the row.** `parseRows` gives you the ordinary cells, and the
credential is fetched separately:

```ts
for (const row of parseRows(config.providers)) {
    const apiKey = await readRowSecret(this.host, 'providers', row, 'apiKey');
}
```

Every row also carries `ROW_ID_KEY` (`$id`), minted by the host the first time the
row is saved and stable across reorders and edits. It exists so a ciphertext can
belong to a row rather than to a position in an array the console rewrites whole
on every save. Ignore it and nothing changes; `readRowSecret` is the only thing
that reads it.

One constraint falls out of that: a field key and a column key may not contain a
`/`, because `rowSecretKey` joins on it. The manifest schema refuses one, so you
find out at load rather than at save.

### Asking for a better control

`control` says how a field should be DRAWN where the ordinary input for its type
reads badly. It never changes what is stored.

| control  | on       | what it draws                                                    |
| -------- | -------- | ---------------------------------------------------------------- |
| `slider` | `number` | a track, using `min`, `max` and `step`. Both bounds are required |
| `tags`   | `string` | chips over a comma-separated line, split and joined by the form  |

Both are opt-in per field rather than inferred, and the reason is the same each
time: a slider is right for a value somebody feels for (a percentage, a trim in
decibels) and wrong for one they have to hit exactly, since 3500 out of 0 to
600000 is a pixel. `tags` suits a set of short names and not a value that can
contain a comma. A field that asks for a control it cannot have — a `slider`
with an open end — falls back to the ordinary input rather than failing, because
this is a hint about drawing and a spinner beats a blank space.

`unit` is the same idea one step further, for a `number` whose stored unit is
not the one a person means: `bytes` is typed in gigabytes, and `fraction` holds
a share between 0 and 1 and is shown as a percentage. The value on the wire is
always the declared unit, so nothing downstream learns that the console converts.

`rangeWith` names the `number` field that is the upper end of the range this one
opens, and is declared on the lower end. They stay two fields with two keys and
two independent validations; what it buys is one control with two handles,
instead of a relationship that lives only in two labels. Declare it where the
range is narrow enough that the whole track is usable — a pair bounded by a
sanity guard rather than by intent leaves both handles bunched at one end.

Note what `min`/`max` are and are not for a plugin. The host stores what it is
handed and **your `configSchema` is what judges it**, so these bound the control
rather than the value: they belong on a field whose range is a fact about your
upstream, and they do not replace a schema. (The station's own settings use the
same descriptor and do enforce them, because the settings route is their only
writer.)

### Choices your server decides

`options` is fixed when the manifest is written, which is fine for a closed set
and useless for anything the operator's own server knows. Implement
`suggestConfigOptions()` and the form asks you what to offer:

```ts
async suggestConfigOptions(): Promise<Record<string, ConfigFieldOption[]>> {
    const models = await this.fetchModels();
    return { model: models.map(id => ({ value: id, label: id })) };
}
```

Implementing it is the whole opt-in — there is nothing to declare on the field.
Return a map so the form costs one call however many fields you have, and leave
out a key you have nothing to say about.

What the operator sees depends on the field's type. A `string` or `url` becomes
free text **with** suggestions, so a value you could not enumerate is still
typeable; a `select` or `multiselect` has its declared options replaced. There is
a refresh control either way, and a field whose suggestions failed is still a
field somebody can use.

Two things to get right, because the failure is a setup loop with no way in:

- **Do not require a field whose value can only be learned from the server.** It
  runs against your SAVED config, like `testConnection` does, so the operator has
  to be able to save the address before they can be told what is on it.
- **Answer with what you have rather than throwing.** An unreachable upstream
  should cost the dropdown, not the form.

## Versioning

`PLUGIN_API_VERSION` is the API version this SDK implements. Your manifest's
`apiVersion` is a semver **range** (`^1.0.0`), and the host refuses to load a
plugin whose range does not cover its own version.
