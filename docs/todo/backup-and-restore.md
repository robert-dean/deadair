# Import and export for everything that is AUTHORED, and the backup that falls out of it

Status: **not built.** This records the design so the next pass does not re-derive it, and in
particular so nobody builds a worse `pg_dump`.

**Designed:** 2026-08-22, from the operator asking for import/export "for everything that makes
sense, including the station settings, so we can provide a backup/restore feature too".
**State of the tree:** 21 migrations, one station, one operator, no export surface anywhere. Nothing
in `apps/api/data/contracts` reads or writes a file that is not media, and no route anywhere emits a
document describing the station's configuration.

## The thing this is FOR, stated first so the scope stays honest

For disaster recovery of one install, `pg_dump deadair` plus a copy of the `media/` tree is strictly
better than anything designed here, costs no code, and already works. A feature that only round-trips
one install's rows is a worse `pg_dump` with a REST API in front of it.

What a dump cannot do, and what this is for:

1. **Move authored configuration onto a DIFFERENT install** — a rebuilt machine, a second station, a
   fresh clone whose catalog ids are all different because it synced its own library.
2. **Share a PIECE of it.** A persona. A format clock. A set of break phrasings. A news category
   list. That is the case that matters the day this ships for other people to self-host, and it is
   the half that makes this worth building rather than documenting a `pg_dump` command in the README.

Backup/restore is then the degenerate case of (1): export everything, import it onto an empty
install. It falls out; it is not the design target, and if the two ever pull in different directions,
(2) wins.

## The four tiers, and only one of them is in scope

Every table in `apps/api/data/migrations` sorts into one of four, and the sort is the whole design.

**Tier 1 — AUTHORED. Cannot be regenerated, and is what the export carries.**

| What | Where |
| --- | --- |
| Station settings | `deadair.settings` (see the secrets section — this is where the difficulty is) |
| Personas | `deadair.personas` |
| Topics (news categories, and whatever kinds come later) | `deadair.topics` |
| The format clock | `deadair.clock_bands` |
| The daypart schedule | `deadair.schedule_slots` |
| The lexicon | `deadair.pronunciations`, `origin = 'operator'` and any `gloss` row the operator has accepted or rejected |
| Saved playlists | `deadair.playlists`, `deadair.playlist_tracks` |
| **Opinions** | `artists.rating`, `albums.rating`, `tracks.rating` — three columns on regenerable rows, which is why they are the hardest entry in this table |
| Plugin configuration and decisions | `deadair.plugin_configs`, `deadair.plugin_grants` |
| Recorded idents | `media/segments/inbox/`, on disk rather than in a table |

**Tier 2 — REGENERABLE. Deliberately out.** The catalog (`artists`, `albums`, `tracks`, the three
`*_sources`, the three `*_enrichment`), `track_analysis`, `facts` / `fact_extractions` and the stored
source documents, `art_assets`, `track_audio` and the bytes under `TRACKS_DIR`, rendered segment
audio, `plugin_storage` (sync watermarks and the like — restoring a stale one is actively worse than
restoring nothing). Re-measuring the catalog and re-running an ingest is cheap and unattended, which
is the rule in `CLAUDE.local.md`, and every one of these is recoverable from an upstream the install
still has credentials for.

**Tier 3 — THE RECORD. Out of the first build, and behind its own flag if ever.** `play_history`,
`script_history`, `segment_events`, `station_events`, `persona_notes`, `productions`. Not
regenerable, because it is history rather than configuration — but large, append-only, and useless on
a different install (a `play_history` row is a claim about a broadcast that machine did not make).
Note the one real cost of leaving it out: `persona_notes` is a character accumulating, and a
character that moves installs arrives with its sheet and no memory. That is the correct default and
should be said out loud on the console rather than quietly.

**Tier 4 — IDENTITY AND LIVE STATE. Never.** `actors` and the five factor tables,
`actors_password_factors_archive`, `permissions_relation_tuples`, the Redis session store,
`station_lineup`, `station_air`, `segments`, `break_requests`, `scrobble_queue`. Exporting credential
material is a category error, sessions already outlive the database and are flushed on any reset
(root `CLAUDE.md`), and the running order is memory-authoritative with the row as its record — an
imported one describes a broadcast nothing is driving. The restore path for identity is the one that
already exists: onboarding mints an admin when `adminExists()` is false.

## The decisions

### An export is keyed by NATURAL keys and never by uuid

This is the one that decides whether the feature works at all. Tier 2 is regenerable, and regenerating
it mints **new uuids** — so a rating exported as `track_id` restores onto nothing, silently, and an
operator who rated four hundred records gets an install that likes none of them and reports no error.

So: `tracks` by `artist_key` + `title_key`, `artists` by `artist_key`, `albums` by
`artist_key` + `name_key`. **Those exact columns, because they are the resolver's own keys** — the
ones `PickResolver.identify`, `CandidatesRepository.findByName` and `play_history` already agree on.
Anything else is a second matcher that can disagree with the one deciding what airs, which is the
failure `rotation.keys.ts` opens by warning about.

The same rule upward, for the references inside tier 1 itself, all of which are uuid columns today:

- `schedule_slots.persona_id` → the persona's `key`.
- `clock_bands.topic_id` → the topic's `kind` + `key`. Note this one **cascades** rather than
  nulling, deliberately (root `CLAUDE.md`), so an import that fails to resolve a topic must refuse
  the band rather than import it subjectless — a general bulletin under a category's name is exactly
  what that cascade exists to prevent.
- `pronunciations.subject_kind` + `subject_id` → the catalog natural key, or dropped: a lexicon entry
  is useful without its subject and `subject_id` is nullable.
- `playlist_tracks.track_id` → catalog natural key, with an honest miss count in the import report,
  since a playlist referencing records this library does not hold is the ordinary case rather than an
  error.

Each tier-1 table already has a natural key of its own for identity on the way in: personas
`(station_key, key)`, topics `(station_key, kind, key)`, pronunciations the partial unique index over
`lower(btrim(written))`, schedule slots `(station_key, starts_at_minutes, days)`. **`clock_bands` has
none** — its identity is `kind` plus the anchored/spacing shape plus `position` — so it is the one
table whose merge has to be composite-keyed by hand or replaced wholesale. Decide that in phase 3 and
write down which.

`station_key` is on every one of these and defaults to `'main'`. The export states the station it was
taken from and the import states the one it is going to; they need not match, and when
[multi-station.md](multi-station.md) lands this is already correct rather than a migration.

### Secrets are the entire difficulty, and the default is REDACTED

`KMS_LOCAL_ROOT_KEY` is read off `AppConfig` at boot and is what `deadair.settings` secret values and
`plugin_configs.secrets` are encrypted with. Three options, and only one of them is a default:

1. **Ciphertext.** Restorable only on an install holding the same root key. Correct for backup/restore
   of one machine, useless for the sharing case, and it fails SILENTLY on the wrong key (a decrypt
   error at first use, days later, from a plugin naming nothing).
2. **Plaintext, re-encrypted under the target's key on import.** Makes the export file a credential
   file: Spotify tokens, LLM keys, the stream secret, sitting in whatever the operator's browser
   downloads to. Not a default under any argument.
3. **Redacted.** The export names WHICH secrets were set, and not their values. The import restores
   everything else and answers with the list of credentials to re-enter.

Default to 3. Offer 1 behind an explicit flag, and make the file state the key fingerprint it needs
so a wrong-key restore fails at import rather than at first use. Never offer 2 as a default; if it
exists at all it is a flag whose name says what it does.

The consequence is that a restored install is not immediately on air, and that is the honest outcome:
a checklist of four credentials beats a station that looks configured and cannot fetch a record.

### An import writes through the SERVICES, never the tables

Two live gotchas make a bulk `insert ... on conflict` wrong here, and both are already documented:

- **A settings write must go through `SettingsService`.** Postgres holds `NOTIFY` until COMMIT, so
  the `LISTEN` on `deadair_settings_changed` fires after the transaction and `store.reload()` is
  deferred through `AfterCommit`. An import writing rows directly leaves the running process on its
  old config until a restart, with the console showing the new values.
- **A `plugin_configs` write must reinit the plugin.** Nothing watches that table; there is no trigger
  and no `LISTEN`. It has to call `PluginLifecycleManager.reinitPlugin` and it has to do it through
  `AfterCommit`, because inline it reads the row as it stood before the write and then waits on the
  lock the request holds — which Postgres does not call a deadlock, because only one of the two is
  waiting in the database.

So the import is a sequence of ordinary service calls in a transaction, and it inherits the deferral
rules those services already have. Anything that grows a faster path owes both.

### Merge or replace, chosen per import and never per row

Two modes, because the two use cases are opposite. **Merge** upserts on the natural keys and leaves
everything unnamed alone: this is the sharing case, and it is what an operator wants when they import
somebody's persona. **Replace** deletes the tables in scope and writes the file: this is the recovery
case, and it must be a distinct verb rather than a checkbox next to a filename.

No per-row conflict UI. It is the feature request that always arrives and that nobody uses; the
dry-run report below answers the same question at a fraction of the cost.

### A dry run is not optional

The import parses, resolves every natural key, and answers what it WOULD create, update, skip and
fail — keyed exactly the way the real pass will key it, by the same code. This is where the ratings
miss count, the unresolvable topic and the playlist's missing records become visible, and it is the
only thing standing between "imported 412 rows" and an operator finding out in a fortnight that their
opinions did not land.

### Replace requires the station to be off air; merge does not

`station_lineup` is memory-authoritative with the director as its sole writer. A replace that rewrites
settings, personas and the schedule under a running broadcast leaves the director holding an order
built under rules that no longer exist and a running order pointing at a persona id that was deleted.
So replace refuses while `station_air` says driving, and says so, rather than standing the station
down on the operator's behalf.

Merge is safe live, and the reason is already built: a persona changing mid-show is expressible
through `recast`, which rewrites `personaId` on the row and re-opens the outgoing host's unaired
breaks. An import that merges a persona and then posts a recast is the whole of what "take effect
now" means here, and it needs nothing new.

### The file, and the honest limit of its version stamp

JSON, one document, with a format version of its own plus the `schema_migrations` list it was taken
at. **The migration list is weak evidence** and the file should not pretend otherwise: migrations in
this repo are edited in place rather than superseded (`CLAUDE.local.md`), so two installs at
`0019_pronunciations` are not necessarily the same shape. The import therefore validates the SHAPES
it reads rather than trusting the number, and the number is for the human reading the failure.

### The media half makes it an archive, and the JSON stays valid alone

Recorded idents under `media/segments/inbox/` are authored — somebody spoke them — so a complete
export is a container (the JSON at the root, the audio beside it). Everything else on disk is tier 2:
track bytes are licensed, re-fetchable and already swept against a cap, art is re-derivable, rendered
break audio is re-speakable from `script_history`'s words. Keep the plain JSON export as its own
answer, because it is the shareable one and because a persona in an email attachment is the case that
justifies this file.

## The seam

- Contracts in `apps/api/data/contracts` per the `contractkit` skill, never hand-edited routers.
  `GET /backup/export` with flags for what to include, `POST /backup/import` with a `dryRun` and a
  `mode`.
- **`platform.manage`**, the same bar `PluginLog` sits behind and for the same reason: the export
  names which secrets exist and carries every plugin's configuration.
- A module of its own rather than a corner of `settings`, because it reaches personas, topics, the
  schedule, the catalog's ratings and the plugin host. It registers LATE in
  `src/modules/modules.ts` — after `PluginsModule`, since importing a plugin config reinitializes a
  plugin — and it holds nothing that needs shutdown ordering.
- Console: a Backup page, using `PageHeader` / `ErrorAlert` / `EmptyState` from
  `src/components/shared/` rather than a fourth hand-rolled set.

## Phases

Each leaves the tree working and is one commit.

1. **Export, JSON, tier 1 only, secrets redacted.** Read-only; nothing can be undone by it. Ends with
   a file an operator can keep, which is most of the value of the whole file.
2. **The parser and the dry run.** Reads a file, resolves natural keys, reports create/update/skip/
   fail. Writes nothing. The same code path the real import will use.
3. **Import, merge mode**, through the services, honouring the settings reload and the plugin reinit.
4. **Replace mode and the off-air guard.**
5. **The archive**, carrying recorded idents beside the JSON.
6. **The record tier behind its own flag** (`play_history`, `script_history`), and only if somebody
   actually wants it. Note `persona_notes` here, not earlier.

## Deliberately not in this

- Actors, credentials, permission tuples and sessions. Onboarding is the restore path for identity.
- The live running order, `break_requests` and `scrobble_queue`.
- Cached track bytes.
- Per-row conflict resolution.
- **A quarantine for imported artefacts, because nothing in tier 1 is executable.** Every row it
  carries is prose or configuration, so an import can be judged by the dry run and nothing else. That
  stops being true the day an operator can author a KIND of break with a data hook attached (see
  [comparable-stations.md](comparable-stations.md)), and the rule to adopt then is the one that
  design already carries: an artefact that arrives with code in it lands **disabled**, and enabling it
  is a separate act by a human who read it. Written down here so that lands as one line rather than as
  a retrofit across an import path that assumed everything it touched was text.
- **Scheduled backups.** That is a cron plus a destination, and there is no destination abstraction
  anywhere in this tree to hang it on. An operator with an export URL and `platform.manage` can write
  a one-line cron themselves; a half-built one that writes somewhere the operator forgot is worse than
  none.
