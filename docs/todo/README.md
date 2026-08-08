# docs/todo

Work that has been designed and deliberately deferred, plus the seam each piece drops into when it
lands. This is not a backlog of ideas: everything here was scoped against the real tree during some
piece of work, then cut to keep that pass on one thing. The point of writing it down is that none of
it needs re-deciding, only building.

Two rules for this directory:

- **A file here describes the current tree.** If a note describes the pre-re-scaffold station, it
  belongs in `deadair_v1` territory, not here. See `docs/decisions/` for calls that were made and
  closed, and the run directories under `.claude/handoffs/` for work that was decomposed and built.
- **Verify before building.** These notes name tables, columns and modules as they stood on the date
  in each file's header. Check `apps/api/src/modules/modules.ts` and the migrations before relying
  on any of it.

| File | What it covers |
| --- | --- |
| [director-and-lineups.md](director-and-lineups.md) | Segments, an LLM DJ, live provider search, the daypart schedule, station permissions, plugins that programme the station, push destinations, rotation rules as settings, palette steering, the station console page |
| [multi-station.md](multi-station.md) | A `deadair.stations` table so one install runs several stations, and what it subsumes |
| [rundown.md](rundown.md) | What the rundown deliberately does not do yet: persistence, playhead corroboration, breaks, mount metadata |
