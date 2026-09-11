---
title: Characters
sidebar_position: 5
description: Who presents the station, what they accumulate as they go, and the checks that keep a model in character.
---

Who is presenting is a character: a sheet you write and switch between. The API calls it a persona; it is the same thing. A character is a voice and nothing else. It decides what the model is told, what the station says when the model declines, and which voice speaks. It says nothing about what the station plays: that is the brief on the [programme](./programme.md).

![Characters: the roster of hosts and callers](/img/console/voice.characters.webp)
*Fig. 1. Characters.*

## The sheet

One host is on air at a time, and a block on the Programme timetable can name its own. Putting a different character on air rewrites the unplayed breaks the outgoing one had lined up.

"Who they are" completes "You are…" and replaces the station's default role outright, because a model told both that it is a radio station and that it is a pirate captain hedges. "How they speak" is the dialect, applied to every sentence and repeated after the station's content rules, which on their own pull a model back to careful plain English. "Their own phrasings" are what the station says in this character when the model declines, ahead of the station-wide phrasings and never mixed with them. Then come signature phrases, sample lines, what they always and never do, and the subjects they keep coming back to, one per break.

A new character can start from a description, which a model turns into a sheet you edit before saving. The roster exports to a file and imports from one. Nine hosts and two callers ship, each with its own voice, and "Restore built-ins" puts back any that are missing.

## Keeping a model in character

Four checks run on every model break, and a failure sends it to the floor, which already speaks in character.

- **Words that prove it.** A break carrying none of the listed marker words is out of character. A sheet that lists none is held to nothing.
- **No lifted lines.** More than five words in a row from a sample line is refused. Under one character, fifteen of seventeen breaks once ended on a copied sample or signature, and all of them passed the marker check.
- **Spent signatures.** A signature just used is off the table for a while; the model is told which, and invited to invent its own.
- **Never say.** The entries that are phrases are checked against the answer.

A news bulletin is excused the first, since "no jokes, no opinions" and "sound like nobody else" cannot both be met. It keeps the other three.

## How much rope

"How much they say" (short, or one line) only ever asks for less. "How much rope they get" (loose, or unleashed) is a permission: room to follow a thought instead of making one point, a ceiling of at least seventy or a hundred words, and at the top rung a looser content licence. It applies to links, welcomes and the character's own stories, never the news or the weather. It never widens station policy: an unleashed character on a clean station talks clean. It switches off no refusal: a break that names neither record or drops the character is still declined.

## The notebook

With "Let a model read each character back to itself" on under Settings, Words (off by default), a model reads each character's broadcast words once a night and writes two kinds of note. A "said before" note records something the character actually said, with the script as evidence, and goes into use unattended. A "settled into" note is an inference about who the character is becoming. No quote can prove that, so it arrives as a suggestion and waits for you. A note you reject stays rejected, and you can write your own.

Only a model reads the notebook, and never in a bulletin: a model reading the news and handed its own past sayings will read one out.

## The stories

A character can have a past: anecdotes it tells on air, each able to gain details over time. A story is fiction, so it is never offered as a fact about a record. At most one reaches any break, least recently told first, and "How often they bring up their own past" governs how often in ordinary talk breaks. A story band on the format clock asks for one outright; a character with none passes that slot over.

"Let a model think of things your characters have lived through" (off by default) runs nightly and only proposes. There is nothing to check a story against, so you are the check: nothing it writes airs until you keep it, and you can turn down one invented detail without losing the story.

## Hearing one before it airs

"Hear a rehearsal" writes and speaks one break from the saved sheet, against the same invented pair of records every time, so two readings a minute apart are comparable. Voice, Auditions runs a character over one of your provider playlists instead, one break per transition, up to fifty. Nothing airs and nothing is spent: the notebook, stories and claims are read and left as they were. A run fills in slowly, since each break waits behind the station's own work. The card tallies what the model wrote against what it declined: the reading to judge a sheet edit by.

## In the console

Voice, Characters is the roster, with "New host" and "New caller"; callers are covered in [Phone-ins](./phone-ins.md). Voice, Voices says which voice reads which character, and Voice, What it said can be narrowed to one character.
