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

"Who they are" completes "You are…" and replaces the station's default role outright, because a model told both that it is a radio station and that it is a pirate captain hedges. "How they speak" is the dialect, applied to every sentence and repeated after the station's content rules, which on their own pull a model back to careful plain English. "Their own phrasings" are what the station says in this character when the model declines. A character with none falls back to the station's own five, plain English, never mixed with a character's. Then come signature phrases, sample lines, what they always and never do, and the subjects they keep coming back to, one per break.

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

"Hear a rehearsal" writes and speaks one break from the saved sheet, against the same invented pair of records every time, so two readings a minute apart are comparable. Voice, Auditions runs a character over one of your provider playlists instead, one break per transition, up to fifty. Nothing airs and nothing is spent: the notebook, stories and claims are read and left as they were. A run fills in slowly, since each break waits behind the station's own work. The card tallies what the model wrote against what it declined: the reading to judge a sheet edit by.

## In the console

Voice, Characters is the roster, with "New host" and "New caller"; each card's menu opens its Notebook, Stories and Memory; callers are covered in [Phone-ins](./phone-ins.md). Voice, Voices says which voice reads which character, and Voice, What it said can be narrowed to one character.
