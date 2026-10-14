---
title: Characters
sidebar_position: 5
description: Who presents the station, what they accumulate as they go, and the checks that keep a model in character.
---

Who is presenting is a character: a sheet you write and switch between. The API calls it a persona; it is the same thing. A character is a voice and nothing else. It decides what the model is told, what the station says when the model declines, and which voice speaks. It says nothing about what the station plays: that is the brief on the [programme](./programme.md).

![Characters: the roster of hosts and callers](/img/console/voice.characters.webp)
*Fig. 1. Characters.*

## The sheet

A block on the Programme timetable can name its own host, and can add more presenters around them: **guest hosts** who sit in on some nights (and say whose show it is), and **co-hosts** who present beside the host, every night or as a visitor now and then. On a show with co-hosts the talk breaks go round them. See [the programme](./programme.md#guest-hosts). Putting a different character on air rewrites the unplayed breaks the outgoing one had lined up, apart from those a co-host still on the show wrote.

"Who they are" completes "You are…" and replaces the station's default role outright, because a model told both that it is a radio station and that it is a pirate captain hedges. "How they speak" is the dialect, applied to every sentence and repeated after the station's content rules, which on their own pull a model back to careful plain English. "Their own phrasings" are what the station says in this character when the model declines. A character with none falls back to the station's own five, plain English, never mixed with a character's. Then come signature phrases, sample lines, what they always and never do, and the subjects they keep coming back to, one per break.

Each of those "in character" quirks has a setting for how often it applies. **Always** is a rule, sent on every break. **Often**, **Occasionally** and **Rarely** make it something the character does now and then: the station picks which talk breaks, about one in two, one in four or one in ten, never more than one such quirk in a break, and never in the news, a welcome or the weather. Leave "now and then" out of the words themselves. A rule that says "once in a while" goes out on every break, and a model with no memory of the last one reads it as "not this time", every time.

A station can also have one **newsreader** ("New newsreader" on the roster, offered while there is none). Every news bulletin is then written in the newsreader's character and read in its voice, whoever is hosting; without one, the host reads the news as before. A newsreader presents a show only if it is a host as well.

A **guest** is somebody who drops by the studio for a short chat with the host: a touring guitarist, a record-shop owner. Like a caller, a guest can be tied to the hosts whose shows they visit. No guests ship; write your own. See [Phone-ins](./phone-ins.md#guests-in-the-studio).

One character can do several of these jobs. **What they do**, near the top of a character's editor, has a box for each: **Hosts**, **Rings in**, **Reads the news** and **Drops by**. Tick as many as you like, and it stays one character, with one sheet, one voice and one notebook. A host who also drops by can guest-host one show and visit another. A character who only rings in or drops by has no phrasings and no picture, because those belong to whoever presents. Nobody is cast into a phone-in or a visit on a show they are presenting that night, and only one character can read the news.

A new character can start from a description, which a model turns into a sheet you edit before saving. The roster exports to a file and imports from one. Nine hosts and five callers ship, each with its own voice, and "Restore built-ins" puts back any that are missing.

## Keeping a model in character

Four checks run on every model break, and a failure sends it to the floor, which already speaks in character.

- **Words that prove it.** A break carrying none of the listed marker words is out of character. A sheet that lists none is held to nothing.
- **No lifted lines.** More than five words in a row from a sample line is refused. Under one character, fifteen of seventeen breaks once ended on a copied sample or signature, and all of them passed the marker check.
- **Spent signatures.** A signature just used is off the table for a while; the model is told which, and invited to invent its own.
- **Never say.** The entries that are phrases are checked against the answer.

A news bulletin is excused the first, since "no jokes, no opinions" and "sound like nobody else" cannot both be met. It keeps the other three.

A talk break or a welcome is also checked against what the station said a few breaks ago. One that repeats a long stretch word for word (the same anecdote again, the same intro read a second time, a line turned into a habit) is sent back once to be said differently, and the phrasings air if the second try repeats itself too. Only long stretches count, so the time, the station's name and a record's title are left alone, and so are the news, the weather and This Day, which repeat because the headline or the conditions have not changed.

## How much rope

"How much they say" (short, or one line) only ever asks for less. "How much rope they get" (loose, or unleashed) is a permission: room to follow a thought instead of making one point, a ceiling of at least seventy or a hundred words, and at the top rung a looser content licence. It applies to links, welcomes and the character's own stories, never the news or the weather. It never widens station policy: an unleashed character on a clean station talks clean. It switches off no refusal: a break that names neither record or drops the character is still declined.

## Writing phrasings

"Their own phrasings" are sentences with holes in them, one per line. A line starting with `#` is turned off without being lost, and blank lines are ignored.

```text
That was {{previous.title}}, from {{previous.artist}}.[[ Next up, {{next.title}}.]]
[[At number {{next.chart.rank}}, ]]here's {{next.artist}}.
# Kept for later: This is {{dj.name}} on {{station.name}}.
```

- `{{…}}` is a placeholder, filled in on each break.
- `[[…]]` is an optional part, dropped whole when a placeholder inside it has nothing to fill it.
- A placeholder outside `[[…]]` that has nothing to fill it rules the whole line out for that break. That is how a line keeps to the breaks it suits, with no conditions to write.

### Placeholders in a character's phrasings

| Placeholder | Fills with | When it has nothing |
| --- | --- | --- |
| `{{previous.title}}` | the record that just played | the first break after a quiet spell |
| `{{previous.artist}}` | who made it | as above |
| `{{previous.chart.rank}}` | its position on the chart it came from | a record no chart placed |
| `{{previous.chart.name}}` | that chart's name | as above |
| `{{previous.album}}` | the album it is from, without "(Deluxe Edition)" and the like | the station does not know it |
| `{{previous.year}}` | the year it came out | as above |
| `{{next.title}}` | the record coming up | nothing is queued yet |
| `{{next.artist}}` | who made it | as above |
| `{{next.chart.rank}}` | its position on its chart | a record no chart placed |
| `{{next.chart.name}}` | that chart's name | as above |
| `{{next.album}}` | the album it is from | the station does not know it |
| `{{next.year}}` | the year it came out | as above |
| `{{station.name}}` | the station's name | never empty |
| `{{dj.name}}` | the character's "On-air name", else the station's presenter name | neither is set |
| `{{clock.daypart}}` | the part of the day: "this morning", "this afternoon", "this evening" or "tonight" | a break that does not yet know when it airs |
| `{{clock.weekday}}` | the day of the week, such as "Friday" | as above |
| `{{clock.rough}}` | the time in words, such as "just after nine" | every break while **Let the station say the hour**, under Settings, Station, is off, as it is to begin with |

`{{previous.name}}` and `{{next.name}}` are the same as `.title`, and `{{previous.artist.name}}` and `{{next.artist.name}}` the same as `.artist`, so a line can read either way.

Four rules decide which line is used:

- **When a record has just played, only lines that name it are used.** A line with no `{{previous.…}}` is kept for the break where there is no record to look back on.
- **Lines recently said are rested**, so the same sentence does not come round every few records.
- **A line that says the time is only true for so long.** One that said "this morning" and was moved past noon, or "Friday" and moved past midnight, is written again before it airs.
- **On a station that does not broadcast in English**, `{{clock.rough}}`, `{{clock.daypart}}` and `{{clock.weekday}}` are never filled, since the station writes them in English. A line naming one is never used there.

The console marks a line that names a placeholder it does not know (a typo such as `{{next.titel}}` would otherwise never be used, silently), one with a single square bracket outside `[[…]]` (it would be read out), and one with no placeholder at all (it would be the same sentence every time). None of these stops a save.

### The station's own phrasings

Everything the station says outside a talk break is phrased under Voice, Phrasings, in the same syntax, and belongs to the station rather than to a character. `{{station.name}}` and `{{dj.name}}` work in all of them. The rest depends on the moment:

| Box | Also fills |
| --- | --- |
| What the station says to a new listener | `{{next.…}}`, `{{greeting}}`, `{{clock.daypart}}`, `{{clock.weekday}}` |
| What the station says in a jingle | nothing else |
| What the station says when the show changes | `{{greeting}}`, `{{clock.daypart}}`, `{{clock.weekday}}`, `{{outgoing.name}}` (the presenter going off, when it is somebody else), `{{outgoing.show}}`, `{{show.name}}` (the show starting) |
| How the station introduces the news | `{{news.headlines}}` (the whole read), `{{news.topic}}` (a band's subject, such as Technology), `{{next.…}}`, `{{clock.rough}}`, `{{clock.daypart}}`, `{{clock.weekday}}`, `{{greeting}}` |
| How the station gives the weather | `{{weather.report}}`, `{{weather.place}}`, `{{news.topic}}`, `{{next.…}}`, `{{clock.rough}}`, `{{clock.daypart}}`, `{{clock.weekday}}`, `{{greeting}}` |
| How the station reads the date out | `{{almanac.report}}`, `{{almanac.date}}`, `{{next.…}}`, `{{clock.rough}}`, `{{clock.daypart}}`, `{{clock.weekday}}`, `{{greeting}}` |

`{{greeting}}` is "good morning", "good evening" and so on, and is empty in the small hours, where `{{clock.daypart}}` says "tonight". Like the three `{{clock.…}}` values, it and the weather and This Day reports are written in English, so on a station in another language they are never filled.

## What a script can carry

Besides words, a character's script can carry three kinds of tag in square brackets. Each is performed or played rather than read out. A model writing as the character is told which ones it may use, and only those, so you never type them into a sheet. They are listed here so you know what to expect in What it said.

### Reactions

A reaction is written at the point it happens: `That one never gets old [laugh] and here it is again.`

| Tag | Host or guest | Caller |
| --- | --- | --- |
| `[laugh]` | yes | yes |
| `[chuckle]` | yes | yes |
| `[sigh]` | yes | yes |
| `[gasp]` | yes | yes |
| `[cough]` | no | yes |
| `[clear throat]` | no | yes |
| `[sniff]` | no | yes |
| `[groan]` | no | yes |

A presenter keeps to the first four, because somebody paid to talk into a microphone who coughs sounds ill. A [caller](./phone-ins.md) on the telephone may use all eight, since that is the realism. One reaction per break at most, and the model is asked to use none unless it would actually have done it.

Reactions are offered in talk breaks, the character's own stories and the turns of a production. Never in the news, the weather or a welcome.

### A reading of the whole break

| Tag | How it is read |
| --- | --- |
| `[hushed]` | quieter, slower, closer to the microphone |
| `[frantic]` | urgent, faster, barely holding on |

It goes first, before any words, and the whole break is read that way. Anywhere else it is dropped. Only talk breaks are offered one, and most want neither.

### The soundboard

`[sfx:name]` plays a sound from the character's soundboard at that point in the sentence, where `name` is the pad's name on Voice, Soundboard (lower-case letters, digits and hyphens, taken from the file's name). Only pads on the presenting character's board are offered, at most one per break, and only in talk breaks and production turns. A pad can be limited to the start, the middle or the end of a break, and given a note on when to reach for it ("after a terrible pun"); the model is shown both. With no model, a talk break written from the phrasings can end on a pad as a sting, once every few breaks.

### What the engine decides

A tag is only offered when the speech engine can perform it right now, and any tag it cannot is taken out before the words are spoken, so an engine never reads "laugh" aloud.

- **Kokoro** performs none of them.
- **Chatterbox** performs the reactions on its `turbo` model and the readings on `original` and `multilingual`, never both at once. Test connection says which the loaded model does.
- **ElevenLabs** (Eleven v4) performs `[laugh]`, `[sigh]`, `[gasp]` and `[clear throat]`, and both readings.
- **Rhapsode** performs whatever its server says each engine can.

A soundboard pad never reaches the engine at all: the station mixes the sound in itself, so it works with any voice.

## The notebook

With "Let a model read each character back to itself" on under Settings, Words (off by default), a model reads each character's broadcast words once a night and writes two kinds of note. A "said before" note records something the character actually said, with the script as evidence, and goes into use unattended. A "settled into" note is an inference about who the character is becoming. No quote can prove that, so it arrives as a suggestion and waits for you. A note you reject stays rejected, and you can write your own. Nothing is learned from a break you thumbed down, so a character cannot be taught to repeat something you said you disliked.

Only a model reads the notebook, and never in a bulletin: a model reading the news and handed its own past sayings will read one out.

## The stories

A character can have a past: stories it tells on air, each able to gain details over time. A story is fiction, so it is never offered as a fact about a record. At most one reaches any break, least recently told first, and "How often they bring up their own past" governs how often in ordinary talk breaks. A story band on the format clock asks for one outright; a character with none passes that slot over.

A story is one of three kinds. A **one-off** is told whole, whenever it comes round. A **story in parts** goes out one part per break, in order, and moves to its next part only once the last one has actually aired. A **running joke** has no end: the presenter keeps coming back to it and building on it. Between returns to the same story or joke the presenter leaves a wait (forty minutes by default), so a listener hears the character come back to something rather than dwell on it. **Returning to a story**, above the roster on Voice, Characters, sets it, from ten minutes to a day; below ten, breaks written ahead could be handed the same part twice.

"Let a model think of things your characters have lived through" (off by default) runs nightly. As well as new stories, it can suggest the next part of a story in parts you started, and notice a running thing a character has been doing on air without it being written down, which it offers only when it can quote the line it heard it in. It also keeps a summary of where each running joke has got to, so the presenter is reminded what the joke has become rather than handed its own last sentences to repeat. There is nothing to check a story against, so by default you are the check: nothing it writes airs until you keep it, and you can turn down one invented detail without losing the story.

## Letting one develop on its own

"Whether they develop on their own", on each character's sheet, decides what the nightly passes do with what they write for that character. **Proposes**, which every built-in ships with, holds new notes and stories for you to approve, as described above. **Self-directed** keeps what it writes, so the character changes from one week to the next without being asked.

That is safe to try because it can be undone. Every time a character carries one of its stories into a break is recorded with what it actually said, and **Memory**, in a character card's menu, lists those tellings newest first. **Roll back to here** on a row returns the character to that point, and the station shows what that would undo before anything happens. Rolling back removes what the station worked out on its own (the tellings, and anything the nightly passes wrote) and never a story, a note or a part you typed yourself. **Clear all of it** starts the character afresh.

## Hearing one before it airs

"Hear a rehearsal" writes and speaks one break from the saved sheet, against the same invented pair of records every time, so two readings a minute apart are comparable. Voice, Auditions runs a character over real records instead: one of the station's own playlists, a provider's playlist or a chart, one break per transition, up to fifty. A chart is read from the top. Records the library does not hold yet are still used, though they come with fewer facts. Nothing airs and nothing is spent: the notebook, stories and claims are read and left as they were. A run fills in slowly, since each break waits behind the station's own work. The card tallies what the model wrote against what it declined: the reading to judge a sheet edit by.

## In the console

Voice, Characters is the roster, grouped into hosts, the newsreader, callers and guests. A character who does several jobs is listed once, under the first of those, with a badge for each of the others. "New host" adds a host; "New caller or guest…" holds New caller, New guest and, while there is none, New newsreader. Each card's menu opens its Notebook, Stories and Memory; callers and guests are covered in [Phone-ins](./phone-ins.md). Voice, Voices says which voice reads which character, and Voice, What it said can be narrowed to one character.
