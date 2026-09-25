-- migrate:up

-- Whether a broadcast takes calls is becoming the PROGRAMME's answer alone, rather than a station
-- default (`rotation.callins`) that anything which said nothing inherited. The default was invisible
-- from the forms that relied on it: a playlist put on with the box unticked still aired callers on a
-- station that took them.
--
-- Two things said nothing and leaned on that default, and both keep what they had before it goes:
--
-- * the sustaining source, which now has a switch of its own (`schedule.sustainingCallins`), given
--   the station's answer here;
-- * a schedule slot whose `callins` is null, which is filled in with it.
--
-- Only a station that took calls has anything to carry. On one that did not, null already means no.
-- The words are `flagIsOn`'s, so a row an operator typed by hand is read the way the station read it.
insert into deadair.settings (key, value)
select 'schedule.sustainingCallins', 'true'
  from deadair.settings
 where key = 'rotation.callins'
   and lower(trim(value)) in ('true', '1', 'yes', 'on')
on conflict (key) do nothing;

update deadair.schedule_slots
   set callins = true
 where callins is null
   and exists (
       select 1
         from deadair.settings
        where key = 'rotation.callins'
          and lower(trim(value)) in ('true', '1', 'yes', 'on')
   );

-- migrate:down

-- The slots cannot be told apart from ones an operator ticked, so they keep their answer.
delete from deadair.settings where key = 'schedule.sustainingCallins';
