# The Icecast 2.5 upgrade

**Written:** 2026-08-10, when the stats poll learned to read either generation's endpoint.
**State of the tree:** `docker-compose.yml` pins `libretime/icecast:2.4.4`. The app now speaks both
2.4's and 2.5's stats endpoints and consumes 2.5's event feed when one is there, so nothing here
blocks the station. What is left is the container itself, and it has a date on it.

---

## Why it has to happen

Icecast **2.5.0 shipped 2025-12-31**. Support for the 2.4.4 the compose file pins ends
**2026-12-31**, and `web/status-json.xsl` in 2.5 carries a deprecation header saying so in the file
itself: kept for 2.4.x compatibility only, migrate to `/admin/publicstats`, consider
`/admin/eventfeed`, no future non-security tickets accepted for it.

## What already landed, so it does not get rebuilt

- `IcecastStatsClient` probes `/admin/publicstats.json` then `/status-json.xsl` and caches the base
  and path that answered together, so the endpoint an install does not have costs one probe per
  re-probe, not one per poll. It refuses to settle on JSON that has no `icestats` object, because
  probing several paths means a proxy's error document can answer 200 on one of them.
- The admin endpoint is read as `admin:<stream.adminPassword>`, HTTP basic, and `status-json.xsl`
  never is. A 401 or 403 there is logged once and falls through.
- `IcecastEventFeed` reads `/admin/eventfeed` (SSE) and hands whole listener counts to
  `AudienceWatch.report()`. It connects **only** when the stats poll resolved the admin endpoint, so
  on the pinned 2.4.4 it never opens a socket.

## What is left

**1. The image.** No 2.5 image is chosen. The current pin comes from LibreTime rather than upstream,
and upstream publishes no official image, so this is a real decision (a maintained third-party 2.5
image, or a small Dockerfile of our own). Two things the replacement must keep, both load-bearing
here: **libcurl**, or `<authentication type="url">` will not start and the listener hooks that make
an arrival instant are gone (`stream.listenerHooks` is the escape hatch, at the cost of up to one
poll interval of silence for whoever just tuned in); and the ability to read the config the app
renders onto the shared volume, which is 2.4-shaped.

**2. `icecast.xml.tmpl` under the 2.5 role system.** 2.5 reads 2.4 configs, so the rendered file
should keep working, but two parts of ours are exactly the parts that changed:

- `<authentication type="url">` on the mount, which is the listener-hook push. Re-verify it admits
  and releases listeners under the new auth stack before trusting the audience gate on 2.5.
- Whether to keep authenticating the stats poll or render an anonymous role that allows
  `publicstats` (`<role type="anonymous" match-admin="publicstats" allow-admin="publicstats"/>`,
  roughly). Authenticating is what the app does today and it works on a default config; a role would
  put the endpoint back where 2.4's was, public. Not decided, and it costs nothing to leave as is.

**3. `display-title`.** 2.5 adds a `display-title` stats key to replace `title` and `artist`. Nothing
reads those from Icecast — the station knows what it is playing because it put it there — but the
comment at `apps/api/src/modules/playout/annotate.ts:39` describes the 2.4 keys, and the console's
`StreamMonitor` reads metadata from the stream itself rather than from stats. Check both when the
image moves.

**4. Verify the two 2.5 paths against a real 2.5.** Everything the app does on 2.5 was written from
the upstream source (`src/admin.c`, `src/event.c`, `src/event_stream.c`) and has never met a running
2.5 server. The shapes to confirm:

```
curl -u admin:<pw> http://127.0.0.1:8000/admin/publicstats.json     # icestats.source, listenurl, listeners
curl -N -u admin:<pw> http://127.0.0.1:8000/admin/eventfeed         # id:/data: frames, source-listener-count
```

`ICECAST_STATS_URL` points the app at a server on another port, which is the cheap way to run a 2.5
container beside the pinned one and watch which endpoint the boot log names.

## One thing that moves if a plugin ever needs it

The SSE frame reader lives in `apps/api/src/modules/stream/icecast.eventfeed.parse.ts` because
Icecast's feed is its only consumer: the LLM plugin's SSE is parsed inside the AI SDK over the
`Response` `host.fetch` returned, and `speak()` returns audio bytes rather than frames. A plugin that
needs to read an SSE API cannot import from `apps/api`, so at that point the parser moves to
`packages/plugin-sdk` beside `jsonBody`/`tryJsonBody`, which are already the same shape: free async
functions over a real `Response`. Until then it stays where its one caller is.
