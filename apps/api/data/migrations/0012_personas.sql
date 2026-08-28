-- migrate:up

-- Who the station is when it opens its mouth.
--
-- This was two free-text settings — `llm.breakPersona` and `llm.setPersona` — handed to a model and
-- reaching nothing else. A table rather than more settings for the reason moods are one in
-- `docs/todo/station-moment.md`: a `ConfigField` describes one row of a form, and this is a list an
-- operator adds to, edits and switches between. The words have to be the operator's, so the words
-- cannot be ours.
--
-- **A persona is wider than a prompt, and that is the whole point.** `templates` is the station's
-- deterministic floor written in this character, so a model that declined — the ordinary case, by
-- design — costs a better sentence rather than the character. `voice` is which of the speech
-- plugin's voices says it. A persona that only reached the model would vanish at exactly the moments
-- the station needs it most.
--
-- **It is a VOICE, and says nothing about what the station plays.** There was a `music` column here,
-- read by the model that chooses records. It was a fourth way to say what to play beside the three
-- keyed to the clock — this broadcast's brief, this daypart's, and the standing sustaining one —
-- and two prose descriptions reaching one local model made it split the difference, so the column
-- had to be withheld from any refill that carried a brief. Dropping it deletes that rule. See
-- `persona.ts`.
create table deadair.personas (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    -- Whose personas these are. Present for the same reason it is on every other station-owned
    -- table: the second station is a row rather than a migration.
    station_key text not null default 'main',
    -- A stable slug, and what a seeded persona is recognised by. Unique per station so seeding twice
    -- is impossible rather than merely unlikely.
    key text not null,
    label text not null,
    -- Completes "You are …". WHO they are; the sheet columns below carry HOW they talk.
    style text not null,
    -- The name this character goes by on air, overriding `station.djName` while it is active. Null
    -- for a persona that is a manner rather than a character.
    dj_name text,
    -- The opaque station voice id a speech plugin maps, or null for that plugin's default. Not a
    -- reference to anything: which voices exist is the engine's business and the host never
    -- interprets the id. See `packages/plugin-sdk/src/capabilities/speech.ts`.
    voice text,
    -- The character sheet's list fields, as jsonb arrays of strings. jsonb rather than text[]
    -- because the whole sheet crosses the wire and is edited as JSON by the console, and a Postgres
    -- array would be the one shape needing a translation at both ends.
    --
    -- `diction` is the dialect that governs EVERY sentence and `quirks` is what the character talks
    -- about; the split is load-bearing and `persona.sheet.ts` explains why. `diction_markers` are
    -- the words whose presence proves the dialect survived, which is what makes a model's answer
    -- checkable rather than merely hoped at.
    diction jsonb not null default '[]'::jsonb,
    diction_markers jsonb not null default '[]'::jsonb,
    quirks jsonb not null default '[]'::jsonb,
    -- The standing subjects this character keeps coming back to, and EXACTLY ONE of them reaches any
    -- one prompt. That is the whole difference from `quirks` above, which all go out every time: a
    -- quirk is a rule about how the character behaves and is true of every break, where these are
    -- material, and material a model is handed gets used — a list of five in a forty-word break is a
    -- presenter reading their own file. It is `persona_stories`' rule one table over, and the
    -- rotation is a cheap spread over the segment id rather than a column, because the question has
    -- no memory worth keeping: see `rotationOf`.
    --
    -- The split with `quirks` is also what keeps a fence honest. A quirk says what this character may
    -- never point a theory at; a preoccupation is what it is pointed at TODAY. Rotating the second
    -- can never loosen the first, because the first is still sent in full.
    preoccupations jsonb not null default '[]'::jsonb,
    catchphrases jsonb not null default '[]'::jsonb,
    avoid jsonb not null default '[]'::jsonb,
    samples jsonb not null default '[]'::jsonb,
    background text,
    -- This character's own break phrasings, one per line, in the syntax of
    -- `rotation.breakTemplates`. Empty means the station's global ones.
    templates text,
    -- Which soundboard this character has to hand: a `deadair.pad_sets.key`, or null for a presenter
    -- who works without one, which is what every persona here did before pads existed.
    --
    -- **Not a foreign key**, and this one is against the precedent rather than with it:
    -- `clock_bands.topic_id` references the table it points at, and a set IS a row so the same thing
    -- was available here. What decides it is where the value comes from — personas are seeded
    -- declaratively from `persona.defaults.ts` and a seed cannot name a uuid, so a key keeps the
    -- seeds readable and lets a shipped persona point at a set nobody has filled yet.
    --
    -- It also keeps two absences as ONE state: a persona with no rack, and one naming a set that
    -- does not exist. `PadRepository.onSet` answers both identically and deliberately, because both
    -- are a presenter with nothing to reach for.
    --
    -- **Were it a foreign key it would be `on delete set null`, which is the opposite of the
    -- `cascade` beside it in 0018.** A band that quietly lost its subject reads a GENERAL bulletin
    -- under a category's name, so losing the band is the better failure; a persona that lost its
    -- rack is a presenter without one, which is most of radio. Cascading would delete the character.
    --
    -- What a key costs is that renaming a set silently unpoints every persona naming it, so the
    -- console asks `PadSetRepository.personasNaming` and says so first.
    --
    -- It is `voice`'s shape one column up, and deliberately: the persona names a SLOT, the library
    -- says what that slot sounds like, and swapping the file under a pad changes what the station
    -- plays without touching a persona or a script. What reaches a model is never this word — it is
    -- the NAMES of the pads on the board, offered the way `[laugh]` is.
    soundboard text,
    -- How much this character says: null for the station's ordinary length, `short` or `one-line`
    -- below it. Only rungs BELOW, and that is the design rather than an unfinished list — measured
    -- on this station, 2 of 137 answers reached the word ceiling and the median came in at 28 words,
    -- so a break is short because the model stops and the question is what it spends those words on.
    -- A longer rung would need the ceiling raised, which is what `latitude` below now does — and it
    -- is a separate column for the reason it is a separate field: what sits above the default is
    -- permission rather than length.
    --
    -- It changes what the model is ASKED for and never `DEFAULT_MAX_WORDS`, because that ceiling
    -- DECLINES rather than trims: lowering it to match would refuse the median break and hand every
    -- one of this character's to the phrasings. See `persona.sheet.ts`.
    brevity text,
    -- How much room this character is given: null for the station's ordinary discipline, `loose` or
    -- `unleashed` above it. The opposite direction to `brevity` and the opposite kind of thing — a
    -- permission rather than a habit — so it moves the word ceiling in the prompt AND in the guard,
    -- swaps the talk break's "make one point" for a licence to follow the thought, and at the top
    -- rung tells the character nothing is off limits in how it says it.
    --
    -- Three bounds hold whatever a row says, and none of them is negotiable from here. The break's
    -- own shape decides whether the room is offered at all (only the ordinary link is), the
    -- station's `rotation.advisory` outranks the language licence, and every existing refusal still
    -- declines to the operator's phrasings. What a rung buys is the station ASKING for more; it
    -- never makes the station accept worse. See `persona.sheet.ts` and `break.prompt.ts`.
    latitude text,
    -- How readily this character works one of its own STORIES into an ordinary talk break: null for
    -- `occasionally`, plus `never` and `often`. The stories themselves are `deadair.persona_stories`
    -- (migration 0021), because they accumulate; this is the one thing about them that is a property
    -- of the character rather than of a story.
    --
    -- It is the first sheet field that never reaches the model. `brevity` and `latitude` are
    -- instructions a prompt carries; this decides whether a story is IN the prompt at all, which is
    -- a host decision. It also governs the ordinary talk break alone: a clock band naming the
    -- `story` kind is an operator asking for one in as many words, and it outranks whatever this
    -- says. See `persona.sheet.ts`.
    storytelling text,
    -- How OFTEN this character talks: null for the station's own interval, two rungs below it and
    -- two above. `brevity` says how long a break is and `latitude` says how much room the character
    -- gets; neither says how often it happens, and until this column that was `rotation.breaks` and
    -- the format clock alone — station-wide, so every character on the roster shared one setting.
    -- A host that talks over every boundary and one that says a line an hour are the same character
    -- at two settings, which is exactly what a per-row rung is for.
    --
    -- **The quietest rung is not silence, and that is a decision rather than an oversight.**
    -- `rotation.breaks` off is already how an operator stops the station talking. A persona that
    -- could switch itself off would be a second switch that can disagree with the first, with
    -- nothing in a log saying which one held — so `reserved` is half as often and never none.
    --
    -- It scales the station's OWN floor and nothing else. A clock band asking for news at nine is an
    -- operator asking in as many words and outranks a habit, which is the same asymmetry
    -- `storytelling` already has against a `story` band. See `persona.sheet.ts` and
    -- `break.planner.ts`.
    chattiness text,
    -- What this character is FOR: `host` is the station's own voice, `caller` is somebody who phones
    -- in to a production and is never the station.
    --
    -- **Not null, and that is a correction rather than a preference.** `docs/todo/personas.md` §1
    -- sketches this column as nullable, with the active index becoming `(station_key, kind)` "with
    -- nulls distinct" once a newsreader exists — and nulls distinct is Postgres's default, so two
    -- rows with a null kind would not conflict and the station could have TWO active hosts. A
    -- positive value has no such hole, and `host` is a real answer rather than an absence.
    --
    -- The newsreader §1 is actually about joins this list when it lands, and the index below can then
    -- be widened safely. Until then it stays keyed on the station alone: a caller is never active, so
    -- there is nothing yet for a wider index to permit.
    kind text not null default 'host' constraint personas_kind_check check (kind in ('host', 'caller')),
    -- Whether this is the one on air. At most one per station, enforced below rather than by
    -- convention, because two active personas is a state nothing downstream could resolve and every
    -- reader would resolve differently.
    active boolean not null default false,

    constraint personas_key_unique unique (station_key, key),
    -- A caller that could be switched on would be a station hosted by whoever rang up about the
    -- lizards. Refused here as well as in `PersonasService.setActive`, because the service answers
    -- the operator and this answers everything else that ever writes the column.
    constraint personas_caller_inactive_check check (not (active and kind <> 'host'))
);

create unique index personas_one_active_idx on deadair.personas (station_key) where active;

select deadair.add_updated_at_trigger('deadair.personas');

-- Which persona a break was written and spoken as.
--
-- Denormalised in the sense that matters: the words and the voice are already ON the segment row, so
-- this answers "who was on air when it was written" rather than being read to produce anything. That
-- is why it is `set null` rather than cascade — a break aired in a character an operator has since
-- deleted still aired, and losing the segment would lose what was actually said.
alter table deadair.segments add column persona_id uuid references deadair.personas (id) on delete set null;

-- Retiring a setting has to take its ROW with it. Nothing reads these two keys any more and nothing
-- declares them, so `GET /settings` never renders them and `PUT /settings` refuses them — which
-- leaves an operator's own words sitting in a table that has no way to show them or delete them.
-- A setting is only really retired once the row is gone.
delete from deadair.settings where key in ('llm.breakPersona', 'llm.setPersona');

-- migrate:down

alter table deadair.segments drop column persona_id;

drop table deadair.personas;
