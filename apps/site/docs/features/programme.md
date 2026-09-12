---
title: The programme
sidebar_position: 2
description: What the station plays across the day and says inside the hour, how a record gets chosen, and the rules no source of records can get round.
---

The programme answers two questions: what the station plays across the day, and what it says inside the hour. The first is the timetable and the second the format clock. Underneath both sit rules about which records may air at all, and they hold however a record was chosen.

![Programme, Today: what is on now, and the format clock](/img/console/schedule.today.webp)
*Fig. 1. Today: the block on air, and the shape of the hour.*

## The timetable

A block is a named stretch of time on chosen days: breakfast, weekdays, six until ten. It says what to play (a playlist, a chart, or nothing, leaving the station to fill it), who hosts it, a brief in your own words, an optional period, a mode, and what happens when it runs out. Two blocks may not overlap.

A schedule need not cover the day. The hours no block claims play the sustaining source: a playlist or a chart, or a brief and a period, with no times attached.

The schedule never interrupts a record: the running order makes each changeover at a record boundary. If you put something on yourself inside a block, yours holds until the next block begins, and the Desk offers to keep it on longer.

## Modes

A **rotation** is the station programming for itself: by default a record does not repeat within three days, an artist rests for 40 minutes after airing, and a batch holds at most two records by one artist. A **setlist** (a sequence somebody made) and a **feature** (one artist, or an album in full) start with those rules off, since a Christmas setlist exists to repeat, and with no breaks, phone-ins or blending, since somebody chose those gaps. Only a rotation keeps going when it runs out; the others stop.

## How a pick is made

When the order needs records, sources are asked in turn, each only for what is still missing:

1. A model, if you let one choose. Off by default.
2. A published chart, for the share of each batch you give it. None by default, so installing a chart plugin changes nothing.
3. Artists similar to what recently aired, up to 40% of each batch, where a plugin such as Last.fm knows who resembles whom. With smart shuffle on, each similar artist contributes a record that has not aired lately where it has one, rather than always its best known.
4. A weighted draw from your library, shaped by the rotation rules and your ratings. With **smart shuffle** on, which is the default, it also leans away from what aired lately: a record that has just played keeps a quarter of its usual chance and warms back up over a fortnight, so the station works through more of your library before it repeats itself. It is a lean and never a rule, so a small library still plays everything.

The last cannot fail, so an hour is always filled, and a partial answer from the model is kept rather than thrown away.

A pick the library has never seen is looked up at your providers and taken into the catalogue, unless you turn off **Play records the station does not own yet**. The match is strict on title and lead artist, because a near miss does not fail: it airs the wrong record while the console names the right one.

## The brief and the period

A brief is what you asked for in your own words: "heavy metal hits". Only a model can read words, so the library draw cannot act on one, and by default it fills what the model could not. An hour briefed "flamenco guitar" can therefore end in whatever else you own. Turn on **A brief is binding** and those slots stay empty instead, and the hour runs short.

A period is a range of years. It is numbers rather than words, so every source honours it, the draw included. A record whose year is unknown plays whatever the period. A record is dated by the earlier of its own year and its album's, because providers often date a track by its reissue.

## Your opinion, and the rules nothing gets round

Records, albums and artists can each be liked, neutral or disliked. A dislike anywhere wins outright: dislike an artist and none of their records air. Otherwise the strongest like carries. Liking an artist means more of them; liking one song means that song more often.

**Explicit content** can play the original, prefer a clean version where one exists, or play only records marked clean. The last is strict: most providers mark nothing, so on their libraries it plays nothing, and says so.

Every pick from every source passes through one final step that applies your dislikes, the period and the explicit-content policy. That includes a playlist you put on air: its order and titles stay as you made them, and a record you disliked still does not play.

## The format clock

The format clock is a list of rules about what the station says inside the hour, each written as a sentence: say a news bulletin every hour at half past, say the weather once a day at 07:00, say an ident every so many minutes. When two rules want the same boundary, the higher one in the list wins.

A rule can be about a subject, such as a news category or a weather location. A bulletin asked for a category it cannot fill declines the slot rather than air the wrong story under the right name. A category marked off air is kept out of every bulletin, which is how a publisher's deals desk stays off your news. Edits apply from the next boundary.

## In the console

**Programme** has three tabs. **Today** shows what is on now and the format clock. **Timetable** is the week: drag a block to move it, drag an edge to change its times, click an empty hour to add one. **Sustaining** is what plays in the hours no block claims. Ratings are set from the Desk's running order and the Library's pages. Rotation rules, explicit content and a binding brief are under **Settings**, **Rotation**; letting a model choose records is under **Settings**, **Words**. Subjects are under **Voice**, **Subjects**.
