---
title: Two recurring shows
description: A Friday morning chart countdown and a nightly metal show, each set up once on the timetable and aired every week, with a presenter who tells the story behind the records.
---

# Two recurring shows

This page builds two shows that air on the station this site is written from. **US Countdown** is a
Friday morning countdown of what America is listening to, with the presenter giving a fact about each
record before it plays. **The Boneyard** is a heavy metal show six nights a week, briefed on the bands
it should play, with two guest hosts who sit in now and then.

Both are ordinary slots on the timetable, set up once and aired every week.
[Make a show](./make-a-show.md) walks through the slot editor field by field; this page uses it twice,
for two different shapes of show.

**You need** a station on air with music. The countdown needs the **Last.fm** plugin with an API key,
because its charts come from Last.fm. It also needs **Play records the station does not own yet** on
under Settings → Rotation, because a chart names records your library mostly does not hold. The
Boneyard is steered by its brief, which works best with **Let a model choose what plays** switched on
under Settings → Words ([Give the station a model](./connect-a-model.md)).

## 1. Make the presenter tell the story

Do this first for the countdown's host. The countdown on this station is presented by the built-in
**Countdown host**, who is set up this way already; any character you write can be.

1. Open **Voice → Characters** and open the character who will present.
2. Find **How much they lean on what the station knows** and choose **Keen — the story behind every
   record**.
3. Save.

A keen presenter is handed more of what the station knows (a note about the album and the artist as
well as the track) and builds each link out of that story, with a longer break to tell it in. Lighter
settings exist for a show where the music matters more than the talk. The Boneyard's host is set to
**Sometimes — one fact now and then**, because a metal show is mostly riffs.

**The presenter only says facts the station has stored.** Each one is a sentence the station took
from a source, such as the record's Wikipedia article, and kept with the words that support it. A
record the station knows little about gets a shorter link, never an invented one.
[Facts and claims](../features/claims.md) explains where the facts come from. Two things give the
station more to say:

- Enable the **Wikipedia** and **MusicBrainz** plugins, if they are not on already.
- Switch on **Let a model find trivia in the articles** under Settings → Words. It reads past each
  article's first line for the details people remember. It runs in the background and takes days to
  get through a library, so turn it on well before the first show.

A countdown is the hardest case for this, because this week's chart is full of records the station
has only just looked up. Expect the early weeks to have shorter links than the records you already
own.

## 2. US Countdown, Friday mornings

Open **Programme → Timetable** and click 09:00 on a Friday. Fill in the **New slot**:

| Field | For US Countdown |
| --- | --- |
| **Name** | `US Countdown` |
| **Starts at** / **Ends at** | `09:00` and `13:00` |
| Days | Friday only. |
| **Playing from** | **Top tracks in United States**, from the **Charts** group. Last.fm publishes a chart for each country, and one for the world. |
| **Played** | **Countdown, ending on number one**. |
| **Hosted by** | **Countdown host**. |
| **Mode** | **Setlist**, so the records play exactly in the chart's order with nothing added. |
| **Host talks between records** | Ticked. A setlist is silent between records otherwise. |

Leave **From year** and **To year** empty. They keep a chart to records from those years, so on this
week's chart they would leave almost nothing to count down.

Save. Each Friday at nine the station reads the chart as it stands that week, keeps as much of the top
of it as fits in four hours, and counts down to number one. Number one may start just before 13:00 and
finish a few minutes into the next show. Turn on **Say each record's chart position** as well if you
want the presenter to give the position, and the record's highest one where the chart says.

### A countdown from a range of years

The charts the plugins publish are this week's. For "the biggest records of 1980 to 1989", play a
playlist instead:

1. Make or import a playlist of that decade's hits, ordered the way they should air: the lowest
   position first and number one last. Under **Library → Playlists**, import it as one of the
   station's own playlists, so a long list starts on time.
2. In the slot, set **Playing from** to that playlist, **Mode** to **Setlist**, and tick **Host talks
   between records**.

A playlist plays from the top every time the slot opens, and the next show starts when its time comes.
Unlike a chart it is not cut to fit, so a playlist longer than the slot never reaches its number one.
Make it about as long as the slot.

## 3. The Boneyard, six nights a week

Click 16:30 on a Monday and fill in another slot:

| Field | For The Boneyard |
| --- | --- |
| **Name** | `The Boneyard` |
| **Starts at** / **Ends at** | `16:30` and `22:00` |
| Days | Monday to Saturday. |
| **Playing from** | Leave it empty, so the station chooses the records against the brief. |
| **Hosted by** | A character written for the show. |
| **Asked to play** | The brief below. |
| **From year** | `1968`, the year heavy metal starts for this show. **To year** stays empty. |
| **Mode** | **Rotation**, the default. |

The brief, as it is on air, shortened:

> All heavy metal, loud. Classics: Black Sabbath, Ozzy Osbourne, Judas Priest, Iron Maiden, Motörhead,
> Dio. Thrash and groove: Metallica, Megadeth, Slayer, Testament, Pantera. Death and black: Obituary,
> Cannibal Corpse, Morbid Angel, Behemoth. Modern: Slipknot, Ghost, Gatecreeper, Alestorm. Doom: Type O
> Negative. Prog: Tool, Gojira, Mastodon, Dream Theater. Mix eras and styles across the hour, riffs
> first.

**Name the acts.** A brief that only says "heavy metal" leaves the model to decide what that means,
and it reaches for the same few bands every night. A brief that names acts gets records by them, a
share of every hour, including acts your library holds only one or two records by: the station looks
those up at your music providers. Grouping the acts by style and ending with how to mix them ("mix
eras and styles across the hour") is what keeps five and a half hours from sounding like one album.

The period does a different job. A brief steers the model but cannot fence it in; a year is a number,
so every way the station picks a record honours it, the model and the library draw alike.

### Guest hosts

Under **Guest hosts**, the Boneyard has two characters who sit in for its host at random: one about one
night in four, the other about one night in five. Random nights are worked out from the date, so the
console and the station always agree on who is on, and a guest knows whose show they are sitting in
on. **Programme → Today** says who is presenting tonight. [Guest hosts](../features/programme.md#guest-hosts)
explains the gap kept between visits.

Save. Saving changes nothing on air now; the station moves when the slot next begins.

## 4. Check it

**Programme → Today** shows the slot on air now and what comes next. When a show starts, the Desk
shows it on air with its presenter, and the running order fills with its records. To hear a presenter
before the first show, audition them ([Write a character](./write-a-character.md)).

## With Claude

With Claude connected and allowed to **Read and manage**
([how](./connect-a-model.md#connect-claude-if-you-want-it-too)), you can ask for both at once:

> Make two weekly shows. US Countdown on Fridays from nine until one, counting down the Last.fm chart
> for the United States as a setlist, with the Countdown host talking between records. And The
> Boneyard, Monday to Saturday from half past four until ten, all heavy metal from 1968 on. Write it a
> brief that names the bands by style. Check the timetable for clashes first and show me what you will
> create.

Claude is good at the Boneyard's half: turning "heavy metal" into a brief that names forty acts across
six styles. Ask it to suggest acts you have not thought of, then edit the list.

## If it goes wrong

- **The countdown is short, or refused.** Nothing on the chart could be found at your music
  providers, a period on the slot ruled most of it out, or **Play records the station does not own
  yet** is off under Settings → Rotation.
- **The countdown plays with no talk.** **Host talks between records** is not ticked. A setlist is
  silent between records without it.
- **The presenter says little about the records.** The station knows little about them yet. Check that
  the Wikipedia plugin is enabled, and give **Let a model find trivia in the articles** time to work.
- **The Boneyard plays the same few bands.** Name more acts in the brief, grouped by style.
- **The Boneyard plays the usual rotation.** **Let a model choose what plays** is off under Settings →
  Words.
- **The slot will not save.** It overlaps another block. Move one of them.

## Next

- [The programme](../features/programme.md) for co-hosts, and specials for a show that runs only on
  some dates.
- [Characters](../features/characters.md) for the rest of what a presenter's sheet controls.
