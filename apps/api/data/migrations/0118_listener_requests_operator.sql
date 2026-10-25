-- migrate:up

-- An operator's request is not held to the rules about the person asking.
--
-- One at a time, the cooldown and the cap exist so the night does not become a jukebox with a
-- voice-over (`request.arbiter.ts`), and they are about listeners. The night is the operator's to
-- shape, so the rules that keep listeners from shaping too much of it have nothing to say to them.
-- `operator` marks a request asked by somebody holding
-- `platform:manage` when they asked, decided once at intake and stored, because two readers are not the
-- request itself: the index below, and the next request's count of the open line, which leaves an
-- operator's rows out so a stack of them never fills the listeners' line.
--
-- The one-open-per-requester index from 0088 is rebuilt without those rows, or an operator's second
-- request would be written down as the database's "one at a time" refusal whatever the arbitration
-- decided. The one-open-per-record index stays as it was: two open requests for one record are a
-- duplicate in the order whoever asked.
alter table deadair.listener_requests add column operator boolean not null default false;

drop index deadair.listener_requests_one_open_per_requester_idx;
create unique index listener_requests_one_open_per_requester_idx
    on deadair.listener_requests (station_key, requester_key)
    where status in ('waiting', 'pending', 'queued') and not operator;

-- migrate:down

-- An operator may have several open requests by now, and the original index cannot be built over
-- them, so all but the oldest of each are let go first, as 0088 did.
update deadair.listener_requests
set status = 'expired', reason = 'It was asked for while another was open, and the first one stands.', decided_at = now()
where status in ('waiting', 'pending', 'queued')
    and id in (
        select id
        from (
            select id, row_number() over (partition by station_key, requester_key order by created_at, id) as per_requester
            from deadair.listener_requests
            where status in ('waiting', 'pending', 'queued')
        ) ranked
        where per_requester > 1
    );

drop index deadair.listener_requests_one_open_per_requester_idx;
create unique index listener_requests_one_open_per_requester_idx
    on deadair.listener_requests (station_key, requester_key)
    where status in ('waiting', 'pending', 'queued');

alter table deadair.listener_requests drop column if exists operator;
