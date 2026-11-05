-- migrate:up

-- The language a character's sheet is written in, as a BCP 47 tag.
--
-- A station has one language (`stream.language`), and a sheet is written in one too, and until now the
-- two were assumed to be the same. They are not on a station that changed its language after it was set
-- up: the characters are seeded once, in English, and stay English. Their sample lines, catchphrases and
-- marker words then reach a German break's prompt as English to copy, and the marker check refuses a
-- German break for not containing English words. Knowing which language a sheet is in is what lets the
-- prompt and the checks tell those apart (discussion 868).
--
-- **Not null, and English for every row that exists**, because every seeded character is written in
-- English and a character written before this column had no way to say otherwise. An operator who wrote
-- a sheet in their station's own language sets it once in the editor. A character saved from now on
-- takes the station's language unless the save names one.
alter table deadair.personas add column sheet_language text not null default 'en'
    constraint personas_sheet_language_check check (length(sheet_language) between 2 and 35);

-- migrate:down

alter table deadair.personas drop column if exists sheet_language;
