-- migrate:up

-- Whether an aired record was a listener's request, or one of the records a request show played
-- after it.
--
-- A show's mix flow limits a genre's share and count, and those amounts are about what the STATION
-- chose: a listener who asks for a black metal record has not used up the show's black metal, and the
-- record that follows a request on a request show was chosen for sounding like it. The running order
-- knows which lines were requests, but it is trimmed as it airs and starts afresh with each broadcast,
-- so a flow counting a whole show reads the history instead, and the history has to say.
--
-- False on every row written before this column existed, which counts them all, as the station did.
alter table deadair.play_history add column requested boolean not null default false;

-- migrate:down

alter table deadair.play_history drop column requested;
