-- migrate:up

-- Which voice the station wanted this said in.
--
-- A name the STATION chose ('host', 'newsreader'), not one any engine knows. The speech plugin
-- maps it to whatever it actually takes — a named preset on one engine, a cloned reference clip on
-- the next — so swapping the engine does not rewrite every segment that ever named a voice. That
-- indirection is the one part of v1's voice handling worth keeping; what is left behind is where
-- the mapping lived, which was a per-provider matrix in the app.
--
-- Null means "whatever the plugin's default is", which is the ordinary case: a station with one
-- voice never sets this, and neither does an imported recording, whose voice is whoever spoke into
-- the microphone. Unconstrained text, like `kind` and `source` beside it: a station that invents a
-- fourth persona must not need a migration to have one.
alter table deadair.segments add column voice text;

-- migrate:down

alter table deadair.segments drop column if exists voice;
