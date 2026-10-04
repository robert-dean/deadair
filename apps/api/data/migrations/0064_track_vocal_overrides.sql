-- migrate:up

-- Where an operator says the singing starts and stops on a record, over whatever its lyrics say.
--
-- Every automation system the trade uses stores the vocal-start cue as an EDITABLE marker beside the
-- outro and the start of the next record, and one of them will not let a talk marker be placed
-- without its partner. Two things follow, and both shape this table: the pair is the unit, and an
-- operator correcting it is expected rather than exceptional. The lyric timings it overrides are
-- typed by volunteers, and #47 measured a quarter of them landing suspiciously early.
--
-- The markers derived from lyrics are NOT stored: they are worked out on every read, so nothing
-- automatic ever writes a marker and so nothing can overwrite this row. That is the hazard the same
-- argument warns about (a walk that revisits every record silently undoing an operator's correction)
-- answered by having no such walk. Clearing a row returns the record to its lyrics.
create table deadair.track_vocal_overrides (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    track_id uuid not null primary key references deadair.tracks (id) on delete cascade,
    -- Nobody sings on this record, whatever its lyrics say.
    instrumental boolean not null default false,
    -- The post: where the first sung word lands, in milliseconds from the start of the FILE, which
    -- is the timeline the lyrics use. The talk-up moves it onto the aired timeline itself.
    onset_ms integer check (onset_ms >= 0),
    -- Where the singing stops. Optional: the talk-up needs only the post.
    end_ms integer,
    constraint track_vocal_overrides_shape_check check (
        (instrumental and onset_ms is null and end_ms is null)
        or (not instrumental and onset_ms is not null and (end_ms is null or end_ms > onset_ms))
    )
);
select deadair.add_updated_at_trigger('deadair.track_vocal_overrides');

-- migrate:down

drop table if exists deadair.track_vocal_overrides;
