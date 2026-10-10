---
title: Write a character
description: Describe a presenter in a sentence, have the model write the whole character sheet, hear it, audition it over an hour of records, and put it on air.
---

# Write a character

By the end of this page the station has a new presenter, written by the model from one sentence of
yours, heard in rehearsal and on air. The same steps write a caller for phone-ins, a guest who drops
by, or the newsreader.

[Characters](../features/characters.md) explains what each part of the sheet does.

**You need** a station with a model ([Give the station a model](./connect-a-model.md)). **Model for
writing a character** under Settings → Words can name a bigger model than the one writing breaks:
nothing is waiting on it.

## In the console

### 1. Describe them

1. Open **Voice → Characters**.
2. Press **New host**. For somebody who rings in, drops by or reads the news, open **New caller or
   guest…** and choose **New caller**, **New guest** or **New newsreader** instead.
3. Under **Start from a description**, write one sentence about who they are. Be specific about the
   place, the era and the attitude: `a 1970s northern soul DJ who broadcasts from the back of a chip
   shop` gives the model more to work with than `a friendly DJ`.
4. Press **Write me one**.

After a few seconds the fields below fill in: who they are, how they talk, the lines they fall back
on, sample lines and the words that prove a break came back in character. Nothing is saved yet.

### 2. Read it, then save

Read the sheet before saving it. Change anything that is not right: it is yours now.

If a box titled **Some of it was dropped** appears, the model wrote something the station could not
use (a catchphrase it never said, or a phrasing naming something the station cannot fill in) and it
was left out. You do not need to do anything about it.

Pick a **Voice** if you have one in mind (empty means the speech plugin's default), then press
**Save**.

### 3. Hear a rehearsal

Open the character again and press **Hear a rehearsal** (or **Rehearse** on its card). The station
writes and speaks one break in this character, against two invented records. Nothing airs and nothing
is stored. A rehearsal speaks the character as it was last saved, so save before rehearsing an edit.

### 4. Audition it over an hour

A single rehearsal shows the voice. An audition shows whether the character stays interesting.

1. Open **Voice → Auditions**.
2. Choose the **Character**, a playlist or chart under **Records from**, and how many **Breaks**. Ten
   is about an hour of radio.
3. Press **Start**.

The run fills in over a few minutes, from **Waiting for the model** to **Writing** to **Finished**.
Read the breaks as they land, and play any of them. Nothing airs and nothing is spent from the
character's notebook or stories.

If the breaks repeat themselves, go back to the sheet: add sample lines, subjects they return to, and
things they never do. Save and audition again.

### 5. Put them on air

On the character's card, press **Make station host**. The next break is in the new character, and
any breaks the outgoing host had written but not aired are rewritten.

To give the character only some shows rather than the whole station, leave the host as it is and name
the character in a show's **Hosted by** instead. See [Make a show](./make-a-show.md).

**A caller or a guest** does not go on air by itself. On their sheet, under **Who they ring** or
**Whose shows they drop by**, choose the hosts they belong to. They are cast into phone-ins and
visits from there; see [Produce a segment](./produce-a-segment.md).

## With Claude

With Claude connected and allowed to **Read and manage** ([how](./connect-a-model.md#connect-claude-if-you-want-it-too)),
you can ask for the same thing in a conversation:

> Write a new host for my station: a retired ship's radio operator who talks about the sea between
> records and has opinions about Morse code. Show me the sheet before you save it.

Claude finds the station's operation for writing a character, shows you the result, and saves it when
you agree. Asking it to show you first matters: it is told to check with you before anything that
deletes, but creating is not deleting. Then rehearse and audition the character in the console as
above, or ask Claude to put them on air.

Claude can also work on characters you already have: "give the late-night host three more sample
lines about the city at 3am" edits the sheet in place.

## If it goes wrong

- **Nothing was written.** No model is answering. Check [Give the station a model](./connect-a-model.md)
  and that **Model for writing a character** names a model your provider has.
- **The rehearsal says nothing writes a talk break.** **Let a model write the talk breaks** is off.
- **Every auditioned break sounds the same.** The sheet is too thin. Give the model more to work with:
  sample lines, subjects, what they always and never do.
- **It speaks in the wrong voice.** The **Voice** is empty or names a voice the speech plugin has no
  row for. [Make a voice](./making-a-voice.md) covers the three names that have to agree.

## Next

- [Make a voice](./making-a-voice.md) to give the character a voice of its own.
- [Make a show](./make-a-show.md) for the character to host.
