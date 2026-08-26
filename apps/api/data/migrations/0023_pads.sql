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
    -- Which directory this file arrived in. PROVENANCE, and nothing decides anything by it.
    --
    -- It was the whole of the rack for one commit — a pad belonged to one board and a persona named
    -- one board — and `deadair.pad_sets` below is what replaced that, for the two things it made
    -- unexpressible. What survives here is only where the file came from, which the console groups by
    -- and a re-scan reports against.
    --
    -- It still does one load-bearing thing: on import a pad joins the SET of the same name, created
    -- if absent. That is what keeps dropping files in a directory a complete answer, with no console
    -- visit and nothing to configure.
    --
    -- Unconstrained text, like `segments.kind` and `lineups.source`: an operator who wants a folder
    -- called `overnight` must not need a migration to have one. `board` rather than `set` because
    -- `SET` is a keyword every UPDATE statement in this file would then have to work around — and
    -- because the two are now genuinely different things.
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
    -- When this pad was last chosen, so a set can be played least-recently-hit first.
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

-- One pad per name per DIRECTORY, which is a rule about imports rather than about resolution: a
-- second file called `airhorn.wav` in one folder replaces the first, and in another folder it is a
-- second pad. Lower-cased and trimmed, since the match is.
--
-- What resolution actually needs is one name per SET, which spans a join and lives in
-- `PadSetRepository.add`. See `pad_set_members`.
--
-- Partial on the same argument the lexicon's is: turning down one air horn must not stop the
-- operator putting a better one under the same name.
create unique index pads_name_idx on deadair.pads (station_key, board, lower(btrim(name))) where state <> 'rejected';

-- The read a scan makes, and what the console groups by: everything that came from one directory.
create index pads_board_idx on deadair.pads (station_key, board, last_used_at) where state = 'active';

-- A named collection of pads: what a presenter is actually handed.
--
-- `deadair.topics`' shape, and for its reason: this is a list an operator adds to, renames and
-- reorders, which is a table rather than a `ConfigField` describing one row of a form. The words
-- have to be the operator's, so the station seeds a vocabulary and every entry in it can be
-- rewritten or deleted.
--
-- ## Why it is not just `pads.board`
--
-- `board` is where a file CAME FROM — the directory it was dropped in — and it was the whole of the
-- rack for one commit. That made two things unexpressible. A stock pack cannot be shared, because
-- every persona names its own board and a `station` board reaches nobody; and one library cannot be
-- cut two ways, because a pad belongs to exactly one board and an operator who wants two characters
-- sharing most drops and differing on two has nowhere to say so.
--
-- So membership moved to the table below and `board` stayed as provenance. What did not change is
-- the zero-configuration path: importing a pad joins it to the set named after its directory,
-- creating that set if absent, so dropping files in `pads/station/` still produces a working rack
-- with no console visit.
--
-- ## Two columns `topics` has that this does not
--
-- No `kind`, because a topic is per `segments.kind` — a bulletin's subjects are not a weather
-- break's — and a set is not per anything. And no `config`: `topics.config` is deliberately shapeless
-- because the code for a KIND reads it, and nothing reads a set's payload, so a column here would be
-- a shape nobody is in a position to define.
create table deadair.pad_sets (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    -- Whose vocabulary this is, as on every other station-owned table.
    station_key text not null default 'main',
    -- The slug anything else refers to this by. `personas.soundboard` holds one of these.
    key text not null check (length(btrim(key)) > 0),
    -- What the console calls it. Never spoken, unlike a topic's label, because a set is a piece of
    -- studio equipment rather than something a break says out loud.
    label text not null,
    -- The operator's own order, for a console drawing a list. No meaning beyond that: two sets never
    -- contest anything.
    position integer not null default 0,

    -- Two sets under one key means a persona naming it reaches whichever the planner felt like.
    constraint pad_sets_key_unique unique (station_key, key)
);

select deadair.add_updated_at_trigger('deadair.pad_sets');

-- Which pads are on which set. Many-to-many, which is the entire point of the table.
--
-- Both sides `cascade`, and they mean different things. Deleting a SET removes its memberships and
-- leaves every pad in the library, because a set is a way of grouping the rack rather than a place
-- the audio lives. Deleting a PAD takes it out of every set it was on, because there is nothing left
-- to reach.
--
-- **A set may not hold two pads under one name**, and that cannot be said here: a script writes a
-- name, resolution happens within a set, and two pads answering to `airhorn` in one set is a break
-- that plays whichever the planner returned first. It spans a join so no unique index expresses it;
-- `PadSetRepository.add` refuses it and the read orders deterministically so a duplicate that got in
-- some other way cannot flip between two renders of one script.
--
-- Note what is NOT a collision: the library legitimately holds two pads called `airhorn`, from two
-- directories, on two sets, reachable by two different characters. That is the feature.
create table deadair.pad_set_members (
    created_at timestamptz not null default now(),
    set_id uuid not null references deadair.pad_sets (id) on delete cascade,
    pad_id uuid not null references deadair.pads (id) on delete cascade,

    constraint pad_set_members_pkey primary key (set_id, pad_id)
);

-- The read a break makes: this set's reachable pads, least recently hit first. Ordered in SQL rather
-- than by the caller so the rotation cannot depend on which pass asked, and indexed from the set
-- because that is the direction every read goes.
create index pad_set_members_pad_idx on deadair.pad_set_members (pad_id);

-- migrate:down

drop table if exists deadair.pad_set_members;
drop table if exists deadair.pad_sets;
drop table if exists deadair.pads;
