-- migrate:up

-- A show made from the news: which of the station's feeds an episode reads, and how far back.
--
-- "News in depth" is a show whose episodes are about the day's stories rather than a standing subject.
-- Asking one for an episode reads the newest stories on these feeds within the window, through the same
-- `NewsService.fetchItems` the bulletin reads them through, so a story an operator kept off the air is
-- kept out of the episode too, and hands them to the research pass as its sources.
--
-- The feed ids are the station's qualified ones (`<plugin>:<feed>`), as a clock band's news topic holds
-- them, in a jsonb array. Null is a show that does not read the news, which is every show before this.
alter table deadair.own_shows add column news_feed_ids jsonb constraint own_shows_news_feed_ids_check check (news_feed_ids is null or jsonb_typeof(news_feed_ids) = 'array');

-- How many hours back an episode reads. Null is the station's default, a day.
alter table deadair.own_shows add column news_hours integer constraint own_shows_news_hours_check check (news_hours is null or news_hours between 1 and 168);

-- migrate:down

alter table deadair.own_shows drop column news_hours;
alter table deadair.own_shows drop column news_feed_ids;
