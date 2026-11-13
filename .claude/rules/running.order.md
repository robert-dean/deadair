---
paths:
    - 'apps/api/src/modules/director/**/*.ts'
    - 'apps/api/src/modules/schedule/**/*.ts'
    - 'apps/api/src/modules/playout/**/*.ts'
    - 'apps/api/src/modules/stream/**/*.ts'
    - 'stream/*.liq'
---

# The running order and what airs

`docs/internals/director.md` and `docs/internals/playout.md` answer different halves of "why is nothing playing". Read the section covering what you change before changing it.

- The director is the sole writer of the running order (`deadair.station_lineup`). Every other writer posts a command to `DirectorService`. A second path into it (a cursor, a revision, a compaction pass, a copy of the queue) is the bug `director.md` § "Who owns the running order" lists four times.
- Prepared material is a playlist; what is airing is the lineup. Never make one the other.
- A record going on air is written through separately (`DirectorService.remember`), or a restart airs it again.
- Nothing is committed until its audio is local (`withLocalAudio`). The gate CUTS at the first cold record rather than filtering, HOLDS a cold record rather than skipping it, and fails OPEN when it cannot read its own answer. `director.md` § "Nothing airs until its bytes are here".
- A break is disposable and a record is not: a failed segment is skipped, a cold record is held.
- `COMMIT_LEAD` and `PLAYOUT_LEAD` move together, and Liquidsoap's `prefetch` comes from the same constant.
- No decoding, mixing or encoding happens in Node. Liquidsoap does it; check a `.liq` edit with `liquidsoap --check` (`stream/README.md`).
