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

## What is left

**1. The anonymous role, if it is ever wanted.** A station could render
`<role type="anonymous" allow-admin="publicstats"/>` and drop the credential from the poll. Nothing
argues for it today: the endpoint already answers anonymously on a default config, and the app holds
the password regardless for the feed. Left as a note so nobody re-derives it.

**2. `display-title`.** 2.5 adds a `display-title` stats key to replace `title` and `artist`. Nothing
reads those from Icecast — the station knows what it is playing because it put it there — but the
comment at `apps/api/src/modules/playout/annotate.ts:39` describes the 2.4 keys, and the console's
`StreamMonitor` reads metadata from the stream itself rather than from stats. Worth a pass when
something next touches now-playing metadata.

**3. The Icecast dashboard.** 2.5 ships a redesigned web interface and warns about legacy sources.
Nobody has looked at what it says about ours, which is a 2.4-style `<mount type="normal">`.

**4. A digest pin.** The image is pinned by version only, and the publisher rebuilds tags in place
when base packages move. `docker inspect --format='{{index .RepoDigests 0}}' libretime/icecast:2.5.0`
gives the digest if that ever matters more than tracking their rebuilds.

## One thing that moves if a plugin ever needs it

The SSE frame reader lives in `apps/api/src/modules/stream/icecast.eventfeed.parse.ts` because
Icecast's feed is its only consumer: the LLM plugin's SSE is parsed inside the AI SDK over the
`Response` `host.fetch` returned, and `speak()` returns audio bytes rather than frames. A plugin that
needs to read an SSE API cannot import from `apps/api`, so at that point the parser moves to
`packages/plugin-sdk` beside `jsonBody`/`tryJsonBody`, which are already the same shape: free async
functions over a real `Response`. Until then it stays where its one caller is.
