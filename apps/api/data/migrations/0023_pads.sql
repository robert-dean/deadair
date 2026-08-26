-- migrate:up

-- The soundboard: short sounds a presenter reaches for, and never a thing that airs on its own.
--
-- A radio host has a rack of pads and hits one. This is that rack. What a pad IS, as far as the
-- station is concerned, is a name a break's script can carry (`[sfx:airhorn]`) and a file the render
-- path joins into the audio between two takes of speech.
--
-- ## Why this is not `deadair.segments`
--
-- That table's own comment says one row is ONE AIRABLE ELEMENT, and an air horn is not one. The
-- consequence is concrete rather than philosophical: `SegmentRepository.readyKinds()` feeds
-- `ClockService`, which offers every ready kind as a BOOKABLE CLOCK BAND, so a `kind = 'pad'` would
-- put "air horn" in the format-clock menu as an hour an operator can schedule the station around.
--
-- That is not a hypothetical. It is the failure migration 0016's joined row had to have patched out
-- of `listReady` and `readyKinds` the moment a production's beats became segment rows — a `callin`
-- kind on the shelf draws a single turn of a past phone-in and airs it alone, which is half a
-- conversation with nobody it was half of. A pad on the shelf would be worse, because it is not even
-- half of anything.
--
-- So: its own table, its own route, and the only thing shared with a segment is the content-addressed
-- store the bytes sit in. Nothing that walks segments can reach one, by construction rather than by a
-- filter somebody has to remember to write.
create table deadair.pads (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    -- Whose rack this is, as on every other station-owned table.
    station_key text not null default 'main',
    -- Which board this pad is on, and therefore which characters can reach it.
    --
    -- `personas.soundboard` names one of these, so a board is the unit a character is given rather
    -- than a tag a pad happens to carry: two presenters sharing a station legitimately have different
    -- racks, and the one thing that must not happen is the newsreader hitting the breakfast show's
    -- air horn because both files were in the same directory.
    --
    -- Unconstrained text, like `segments.kind` and `lineups.source`: an operator who wants a board
    -- called `overnight` must not need a migration to have one. `board` rather than `set` because
    -- `SET` is a keyword every UPDATE statement in this file would then have to work around.
    board text not null check (length(btrim(board)) > 0),
    -- What a script writes to hit this pad, and the ONE thing a model is ever told about it.
    --
    -- Free text and matched case-insensitively, exactly as `pronunciations.written` is, because a
    -- model handed a list of names will not reliably give one back in the case it was offered in.
    -- The station's vocabulary rather than any engine's, on `segments.voice`'s argument: the file
    -- under this name can be replaced without a single script changing.
    name text not null check (length(btrim(name)) > 0),
    -- What the console calls it. Derived from the filename on import, as a segment's label is, and
    -- separate from `name` because one is prose for a person and the other is a token for a model.
    label text not null,
    -- sha256 of the audio, hex, and its extension on disk: together they are the file under the
    -- segment store's root.
    --
    -- BOTH NOT NULL, which is where this differs from `segments` and is the whole difference between
    -- the two tables read as a state machine. A segment is planned before it exists, because the
    -- station decides to say something and then works out how; a pad arrives as audio and has no
    -- earlier state to be in. There is nothing here to render, so there is no `state` per stage and
    -- no way for a pad to be half made.
    audio_checksum text not null,
    audio_ext text not null,
    -- How long it runs, and how loud it came out. Both `segments`' columns exactly, including the
    -- reasoning: a display value that nothing schedules against, and one number on the way to the
    -- mount that falls back to an assumed level where it is null.
    --
    -- The loudness matters more here than it does for a break, and in the opposite direction. A pad
    -- is mastered by whoever made it and an air horn is mastered LOUD, so joining one against a
    -- speech take measured at -27 LUFS is how a soundboard takes somebody's ears off.
    --
    -- **What reads it today is a PERSON**, and that is worth stating rather than leaving to be
    -- discovered: nothing computes an `AudioOverlay.gainDb` from this yet. It is measured on import
    -- and reported on the soundboard page so an operator can see that their air horn is twelve
    -- decibels hotter than the words it is about to land on, and re-master it or set the duck. An
    -- earlier version of this comment said the join reads it, which was aspiration written as fact.
    duration_ms integer constraint pads_duration_check check (duration_ms is null or duration_ms >= 0),
    loudness_lufs double precision,
    -- Where it came from: 'library' for a file dropped into the inbox. Unconstrained text, like
    -- `segments.source`, so an upstream pad library is a value rather than a migration.
    source text not null default 'library',
    -- The file in the inbox this was imported from, kept so the console can say where a pad came
    -- from and a re-scan can report one it already knows. Not a path the server reads back: the
    -- bytes were copied into the store on import, so emptying the inbox does not silence a pad.
    source_path text,
    -- When this pad was last chosen, so a board can be played least-recently-hit first.
    --
    -- Stamped at SELECTION rather than after the break airs, which is `chooseFacts`' documented
    -- inaccuracy taken deliberately for its reason: the alternative is a second writer downstream
    -- that can disagree with this one about what was spent. A break dropped before its slot has
    -- still rested its pad, and a rested pad is a pad somebody else gets a turn with.
    last_used_at timestamptz,
    -- 'active' is reachable. 'rejected' is an operator having turned one down, and it is a STATE
    -- rather than a deletion for `pronunciations`' reason one table over: the inbox scan re-reads
    -- the directory, so a deleted row comes straight back on the next pass, forever.
    state text not null default 'active' constraint pads_state_check check (state in ('active', 'rejected'))
);
select deadair.add_updated_at_trigger('deadair.pads');

-- One pad per name per board, because a script names a pad and two rows answering to one name are
-- two files that cannot both be hit. Lower-cased and trimmed, since the match is.
--
-- Partial on the same argument the lexicon's is: turning down one air horn must not stop the
-- operator putting a better one under the same name.
create unique index pads_name_idx on deadair.pads (station_key, board, lower(btrim(name))) where state <> 'rejected';

-- The read a break makes: this board's reachable pads, least recently hit first. Ordered in SQL
-- rather than by the caller so the rotation cannot depend on which pass asked.
create index pads_board_idx on deadair.pads (station_key, board, last_used_at) where state = 'active';

-- migrate:down

drop table if exists deadair.pads;
