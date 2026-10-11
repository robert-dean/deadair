-- migrate:up

-- One open request per person, and one per record, held by the database rather than by a read.
--
-- `RequestDesk.submit` decides on a request from the open rows it has just read, then inserts. Two
-- submits from the same person a moment apart (a double tap in the app, or the app and a linked chat)
-- both read "nothing open" and both insert, and the same goes for two people asking for one record.
-- These two indexes make the second insert fail with a unique violation, which the repository turns
-- into the same refusal the arbitration would have given had the two arrived one after the other.
--
-- Open is `waiting`, `pending` or `queued`, exactly `OPEN_STATUSES`. A `declined` row is outside both
-- indexes, which is what lets the loser of a race still be written down as refused.
--
-- The cap on how many are open at once is a count and cannot be an index, so a true race can take it
-- one over. Nothing is locked through placing a request, and one extra record in the line is a better
-- failure than a lock held across the director.
--
-- Any duplicates already present are let go first, keeping the oldest of each, since an index cannot
-- be built over them. There should be none: the arbitration refuses them whenever two submits do not
-- overlap.
update deadair.listener_requests
set status = 'expired', reason = 'It was asked for twice at once, and the first one stands.', decided_at = now()
where status in ('waiting', 'pending', 'queued')
    and id in (
        select id
        from (
            select
                id,
                row_number() over (partition by station_key, requester_key order by created_at, id) as per_requester,
                row_number() over (partition by station_key, track_id order by created_at, id) as per_track
            from deadair.listener_requests
            where status in ('waiting', 'pending', 'queued')
        ) ranked
        where per_requester > 1 or per_track > 1
    );

create unique index listener_requests_one_open_per_requester_idx
    on deadair.listener_requests (station_key, requester_key)
    where status in ('waiting', 'pending', 'queued');

create unique index listener_requests_one_open_per_track_idx
    on deadair.listener_requests (station_key, track_id)
    where status in ('waiting', 'pending', 'queued');

-- migrate:down

drop index if exists deadair.listener_requests_one_open_per_track_idx;
drop index if exists deadair.listener_requests_one_open_per_requester_idx;
