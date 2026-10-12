-- migrate:up

-- What a production may state as fact: a list of short notes, each one something the station was told
-- rather than something a model remembers.
--
-- Every pass ran with no tools and a grounding block that keeps a programme vague, so a podcast about a
-- subject was the model's general knowledge with every specific taken out. Notes are the material it is
-- allowed to be specific about. The outline is handed them as its items and divides them between the
-- beats, and each beat is told its own notes and that they are everything the station knows, which is
-- the sentence a phone-in about the records just played already gets for its records.
--
-- A jsonb array of strings, as the persona sheet's lists are, because the whole list crosses the wire as
-- JSON and is only ever read whole. Null is a production nobody gave any notes, which is every row
-- written before this migration and still the ordinary case.
alter table deadair.productions add column notes jsonb constraint productions_notes_check check (notes is null or jsonb_typeof(notes) = 'array');

-- migrate:down

alter table deadair.productions drop column notes;
