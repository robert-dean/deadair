-- migrate:up

-- A slot whose source is a playlist can pick it up where it left off, rather than from the top.
--
-- A playlist slot airs its playlist in the playlist's own order, and reads it whole every time the
-- block opens. On a long playlist and a short recurring slot that is the first hour, every night, and
-- the rest of the playlist never airs. An operator's takeover ending inside the block is a second
-- opening, so it restarted the playlist part-way through the show as well.
--
-- `resume_playlist` is the operator's choice and the slot row is the right place for it, because it
-- is configuration. Where the playlist GOT TO is not: this table's header in 0017 says the slot row
-- never holds current state, and a position is exactly that. It lives beside the slot instead, one
-- row per slot, as `schedule_prepared_sets` does (0080), and it is prepared material for the next
-- opening rather than a cursor over anything that airs: the running order is still built whole at
-- the changeover and consumed, and the director is still its only writer.
--
-- `last_song_key` is the song key of the last record from the playlist that actually aired. A key
-- rather than a row number, because a provider's playlist has no stable row position to hold: a
-- record added near the top would move every number after it, and the station would skip or repeat
-- by that many. A key that is no longer on the playlist starts it from the top again.
--
-- The foreign key cascades for the prepared set's reason: deleting a slot takes its place with it, and
-- `ScheduleRepository.update` deletes the row when an edit changes the slot's source, since a place
-- in one playlist means nothing in another.
alter table deadair.schedule_slots add column resume_playlist boolean not null default false;

create table deadair.schedule_playlist_positions (
    slot_id uuid primary key references deadair.schedule_slots (id) on delete cascade,
    last_song_key text not null,
    updated_at timestamptz not null default now()
);

-- migrate:down

drop table deadair.schedule_playlist_positions;
alter table deadair.schedule_slots drop column resume_playlist;
