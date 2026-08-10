# The Icecast 2.5 upgrade

**Written:** 2026-08-10, when the stats poll learned to read either generation's endpoint.
**Updated:** 2026-08-10, when the container moved to 2.5.0 and the two shapes below were measured
against it rather than inferred.
**State of the tree:** `docker-compose.yml` runs `libretime/icecast:2.5.0`. The app reads
`/admin/publicstats.json` and follows `/admin/eventfeed` on it, and still reads `/status-json.xsl`
on a 2.4 server. The upgrade is DONE; what is left is the smaller list at the end.

---

## Why it happened

Icecast **2.5.0 shipped 2025-12-31**, and support for the 2.4.4 this repo ran ends **2026-12-31**.
`web/status-json.xsl` in 2.5 carries a deprecation header saying as much in the file itself: kept for
2.4.x compatibility only, migrate to `/admin/publicstats`, consider `/admin/eventfeed`, no future
non-security tickets accepted for it.

## What landed, so it does not get rebuilt

- `IcecastStatsClient` probes `/admin/publicstats.json` then `/status-json.xsl` and caches the base
  and path that answered together, so the endpoint an install does not have costs one probe per
  re-probe, not one per poll. It refuses to settle on JSON that is not a stats document, because
  probing several paths means a proxy's error document can answer 200 on one of them.
- The admin endpoint is read as `admin:<stream.adminPassword>`, HTTP basic, and `status-json.xsl`
  never is. A 401 or 403 there is logged once and falls through.
- `IcecastEventFeed` reads `/admin/eventfeed` (SSE) and hands whole listener counts to
  `AudienceWatch.report()`. It connects **only** when the stats poll resolved the admin endpoint, so
  against a 2.4 server it never opens a socket, and it attaches on the poll that discovers a 2.5 one.
- The image is `libretime/icecast:2.5.0` (same publisher as the old 2.4.4 pin, built from source with
  `libcurl4` in the runtime layer, which is what the listener hooks need). 2.5 accepted the 2.4-shaped
  `icecast.xml` the app renders, unchanged, including `<authentication type="url">`: a real listener is
  admitted and released, and the paths in `stream/icecast.xml.tmpl` still match the image layout.

## The two shapes, measured

Both endpoints carry the same facts in different shapes, and NEITHER matches what upstream's source
suggests. Written down because the first version of this client was inferred from `src/admin.c` and
`src/event.c` and read zero listeners off a live 2.5.

`GET /admin/publicstats.json` — an ARRAY, a namespace header first, the stats second with no
`icestats` wrapper, and `source` keyed by mount rather than an array or a bare object:

```json
[ { "name": "icestats", "ns": "http://icecast.org/specs/legacystats-0.0.1" },
  { "server_id": "Icecast 2.5.0",
    "source": { "/live.mp3": { "listeners": 1, "listenurl": "http://127.0.0.1:8000/live.mp3" } } } ]
```

`GET /admin/eventfeed` — SSE, and the event's fields are nested under `crude` with the count as a
STRING:

```
id: 2b272bf4-…
data: {"type":"event","mount":"/live.mp3","crude":{"trigger":"source-listener-attach",
       "uri":"/live.mp3","source-listener-count":"1","connection-ip":"172.21.0.1"}}
```

Both are covered by tests holding these payloads verbatim, in
`tests/modules/stream/icecast.stats.client.test.ts` and `icecast.eventfeed.parse.test.ts`.

Also measured: `publicstats` answers an ANONYMOUS request on this build, while `eventfeed` returns
401. The app authenticates on both anyway, since access is a role decision an operator can tighten.

## The dashboard, and what it asked for

2.5's admin dashboard carries a maintenance panel. On this station it raised four items; three are
answered and the fourth is a decision already recorded elsewhere.

| Item | Answer |
| --- | --- |
| Hostname not useful | `stream.publicUrl` (or `stream.hostname`). Cleared. Note Icecast prefers the request's `Host` header for `listenurl` and falls back to `<hostname>`, so the loopback probe still reads `127.0.0.1` while a request through the edge reads the public name |
| Location not useful | `stream.location`, rendering `<location>`. Cleared. Empty renders no element rather than the `Earth` placeholder the template used to hardcode |
| No content language | `stream.language` → `STREAM_LANGUAGE` → Liquidsoap's `Content-Language` header on the source connection, which is the only way Icecast learns one. Cleared; the value shows as `content-language` in `/admin/stats.json` |
| Legacy/unsupported format | **Permanent, by choice.** Icecast handles Ogg, Opus and WebM natively and routes everything else through a generic best-effort handler, so any MP3 mount raises this. The answer is a different container, which is `docs/todo/stream-formats.md`, not configuration |

A `no-aged` flag ("the stream did not mature yet") also appears for a while after a source
reconnects. It is transient and needs nothing.

The 2.4-era metadata note in `annotate.ts` is corrected: 2.5 reports `display-title`, `publicstats`
drops `title` entirely, and neither version ever splits out an `artist`. 2.5 also keeps a `playlist`
of recent titles on the mount, which is a lossy echo of what the rundown already knows.

## What is left

**1. The anonymous role, if it is ever wanted.** A station could render
`<role type="anonymous" allow-admin="publicstats"/>` and drop the credential from the poll. Nothing
argues for it today: the endpoint already answers anonymously on a default config, and the app holds
the password regardless for the feed. Left as a note so nobody re-derives it.

**2. A digest pin.** The image is pinned by version only, and the publisher rebuilds tags in place
when base packages move. `docker inspect --format='{{index .RepoDigests 0}}' libretime/icecast:2.5.0`
gives the digest if that ever matters more than tracking their rebuilds.

## One thing that moves if a plugin ever needs it

The SSE frame reader lives in `apps/api/src/modules/stream/icecast.eventfeed.parse.ts` because
Icecast's feed is its only consumer: the LLM plugin's SSE is parsed inside the AI SDK over the
`Response` `host.fetch` returned, and `speak()` returns audio bytes rather than frames. A plugin that
needs to read an SSE API cannot import from `apps/api`, so at that point the parser moves to
`packages/plugin-sdk` beside `jsonBody`/`tryJsonBody`, which are already the same shape: free async
functions over a real `Response`. Until then it stays where its one caller is.
