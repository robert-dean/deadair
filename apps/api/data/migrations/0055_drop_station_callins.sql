-- migrate:up

-- Whether a broadcast takes calls is the programme's answer alone now, and `rotation.callins` is read
-- by nothing. 0054 gave the station's answer to everything that leaned on it before this goes.
delete from deadair.settings where key = 'rotation.callins';

-- migrate:down

-- Nothing to restore: a missing row reads as the old default, which was off.
