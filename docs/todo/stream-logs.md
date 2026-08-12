# The stream containers have no readable log, and nothing bounds the ones they have

**Written:** 2026-08-12, after an hour of diagnosing why nothing was airing without ever being able to
read Liquidsoap's log.
**State of the tree:** `radio.liq` sets `settings.log.level.set(3)` and nothing else about logging, so
Liquidsoap logs to stdout and only to stdout. `spotify-shim.log` is the one stream-side log on disk,
append-only, never rotated. No compose service declares a `logging:` block. The app's own logs are
fine and already rotate (`RotatingLogStore`, `LOG_MAX_*`, dated files in `.docvol/logs`).

---

## What prompted this

An item pushed to Liquidsoap was accepted, resolved and dropped within a second or two, over and over,
and the mount stayed on its own bed. The log that would have named the cause goes to stdout, which
means `docker compose logs liquidsoap` — and the Docker socket is exactly what an in-sandbox session
cannot reach (`config-watch.sh` says the same thing from the other side: the app "has no Docker socket
and should not have one"). So the diagnosis was three control experiments instead of one `tail`:

| Pushed | Path | Result |
| --- | --- | --- |
| A cached record | `/playout/audio/{sourceId}` | resolved, dropped in <2s |
| The same record, signed shim URL | the pre-`61d18a0` provider path | resolved, dropped |
| A `ready` ident, mp3 | `/segments/{id}/audio`, older than any of this | resolved, dropped |

All three behave identically, which rules out the one-path track-audio work, the format and the route,
and leaves the stream container itself. **The cause is still unknown** — that is not what this file is
about, but the next person to hit it should know the three experiments are already done and that the
missing log is why they were needed.

Also measured on the way past: `spotify-shim-run: starting` appears 65 times in the shim's log, several
of them yesterday, and the restarts follow shim FETCHES rather than plays; Liquidsoap's control
endpoint never dropped through any of them, so that is the shim's wrapper restarting it and not the
container going down.

## What Liquidsoap gives us, which is not rotation

The complete set of file-logging settings:

| Setting | Default | Note |
| --- | --- | --- |
| `settings.log.file` | **`false`** | the master toggle; setting only the path creates nothing |
| `settings.log.file.path` | `<syslogdir>/<script>.log` | `<script>` / `<syslogdir>` substitutions only — **no strftime**, so it cannot roll to a dated name |
| `settings.log.file.append` | `true` | `false` truncates at every start |
| `settings.log.file.perms` | `384` (`0o600`) | matters if anything else reads the file |

There is no size cap, no retention and no rotation. Rotation is external AND cooperative: Liquidsoap
does not notice its file being renamed, so logrotate has to send **SIGUSR1** in a `postrotate` hook to
make it reopen. Without that, the documented symptom is Liquidsoap still writing to `radio.log.1`
while the new file sits at zero bytes. The Debian package ships that logrotate config, which is why
upstream tells you not to override `log.file.path` on a packaged install.

**None of that machinery exists here.** `stream/Dockerfile` is `savonet/liquidsoap:v2.4.5` plus curl
and ca-certificates: no logrotate, no init.d, no cron, no PID file, and nothing to deliver a signal.
The app cannot send one either — it is in another container and has no socket, deliberately.

## The three options, and what each costs

**1. Bound stdout in compose.** No new moving parts and no cleanup job at all:

```yaml
logging: { driver: json-file, options: { max-size: 10m, max-file: "3" } }
```

Docker does the rotating, `docker compose logs` keeps working, and it applies to all six services
rather than just Liquidsoap. It does NOT make the log readable without the socket, so it solves the
disk-growth half and none of the diagnosis half.

**2. `settings.log.file` with `append := false`.** A file on the mounted `/streamlogs`, truncated at
every container start, so it is bounded by one uptime and needs no job. The cost is the whole point of
having it: the log is gone after a restart, and the restart is usually what you are investigating.
That is exactly what happened above — the drops preceded the looking.

**3. Dated files written by the entrypoint, swept by the app.** The only shape that is both readable
without a socket and bounded. Liquidsoap cannot produce a dated filename itself, so the entrypoint
tees its stdout into `/streamlogs/liquidsoap-<date>.log`; because the NAME changes, deleting yesterday's
is safe. The same trick fixes the shim's log, which has the identical problem today.

Deleting is the part that has to be got right: a file Liquidsoap holds open can be unlinked and
reclaims nothing until restart, and truncating it from outside leaves a sparse file full of NULs
because Liquidsoap keeps writing at its old offset. Hence dated names rather than a sweep over one
file.

## Which half is a knob, and which is not

The restart objection this would have carried a week ago is **gone**, and that is the thing worth
knowing: `radio.liq` reads its configuration through `environment.get(...)` at startup, and
`config-watch.sh` restarts the container when the app re-renders `/streamconfig`. So a logging setting
behaves like any other stream setting — change it, the app re-renders `radio.env`, the container
restarts itself onto it within a poll. Same conclusion `mixer-settings-in-db.md` reached on
2026-08-11.

- **Enable and path: a real setting.** One `STREAM_KEYS` entry materialized into `radio.env` (say
  `LOG_FILE_PATH`), read in `radio.liq` as `environment.get("LOG_FILE_PATH", default="")` and applied
  only when non-empty. It spends a restart, which `config-watch.sh` now performs and
  `stream.staleness.ts` already reports on.
- **Docker's `max-size` / `max-file`: not a knob.** Compose reads those at container-create time, so
  they are a deploy-time value, not something `deadair.settings` can carry.
- **Retention: the knob that earns itself**, because the APP does the deleting and no restart is
  involved. `stream.logRetentionDays` plus a nightly sweep over `/streamlogs`, mirroring
  `render.scriptHistoryDays` + `PruneScriptHistoryJob` exactly — one delete, `retryLimit: 0`, "the
  cron IS the retry", and `0` meaning keep everything. It only works over dated files, per above.

## The seam

- `stream/radio.liq` — the `settings.log.*` lines, beside the existing `settings.log.level.set(3)`.
- `stream/Dockerfile` + the compose entrypoint — where the tee would go; `/streamlogs` is already
  created `0777` and already bind-mounted to `.docvol/streamlogs`.
- `docker-compose.yml` — the `logging:` block, per service.
- `apps/api/src/modules/stream/stream.settings.ts` + `settings.registry.ts` — `STREAM_KEYS` and the
  descriptor, if the path becomes a setting.
- `apps/api/src/modules/jobs/job.mappings.ts` — the nightly sweep, next to
  `render.prune_script_history`, which is the pattern to copy rather than invent.

## Smallest useful slice

The compose `logging:` block. Two lines per service, bounds what is already growing unbounded on every
container, and needs no setting, no job and no restart trigger. Everything else here is worth doing
only if the missing-log problem bites again — which, given the drop above is unexplained, it probably
will.

## Sources

- [Liquidsoap: using in production](https://liquidsoap.readthedocs.io/en/latest/content/in_production.html) — the "do not override `log.file.path`" advice and why
- [Liquidsoap settings reference](https://www.liquidsoap.info/doc-dev/settings.html) — the defaults in the table above
- [savonet/liquidsoap#148](https://github.com/savonet/liquidsoap/issues/148) and
  [#1995](https://github.com/savonet/liquidsoap/issues/1995) — logging stops after logrotate without
  the SIGUSR1 hook
- [savonet/liquidsoap-daemon#26](https://github.com/savonet/liquidsoap-daemon/issues/26) — a logrotate
  glob that matched nothing, which is the failure mode that looks like it works
