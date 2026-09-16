---
title: Readings
sidebar_position: 6.6
description: "How the station reads somebody else's writing out loud: point a narration plugin at a book or a column, put a narration band on the format clock about it, and at that time the station reads the next piece in its presenter's voice."
---

The station can read somebody else's writing out loud: a chapter of a book, an issue of a newsletter, a long read. Give it a series through a narration plugin, put a `narration` rule on the format clock about that series, and at that time the station reads the next piece, whole, in its own voice.

It is the third of three things that fill an hour with something other than records, and the words are what tell them apart:

- A **reading** is somebody else's text, spoken by the station. No model writes a word of it.
- A **[podcast](./podcasts.md)** is somebody else's audio, fetched and aired. A `syndicated` rule on the clock.
- A **[production](./phone-ins.md#other-productions)** is the station's own programme, written and spoken by it. A `podcast` rule on the clock, confusingly, and that word has been taken.

A reading is the station's own speech, so it gets everything the presenter gets: the pronunciation lexicon, the performance cues, a real voice and a real loudness measurement. That is the whole reason it is not just a podcast with the audio missing.

## Where the words come from

A narration plugin hands the station pieces of text. It names the series it holds and, for each piece, the words themselves. It never makes audio: the station has one speech engine and the presenter has it.

**Nothing bundled provides one.** The capability is there and the console has a page for it, but none of the thirteen plugins in the image offers anything to read. You install a plugin somebody wrote, or write one: [Writing plugins](../plugin-development/index.md) covers it, and `narration` is one of the capabilities in [the contract](../plugin-development/contract.md).

The line between a narration source and a [news](./library.md) source is not what it publishes but what its words are for. A headline is something to talk about, and what airs is a sentence a model wrote. A chapter is meant to be heard as it stands. A source whose text would need summarising is a news source even if it publishes books.

The station reads every series twice an hour and remembers the pieces each one holds. **Look for new pieces** on the Readings tab does it straight away.

## Putting a series on the clock

1. Add the series under **Voice**, **Subjects**, as a **series**. Pick it from what your narration plugins offer; the name you give it is what your presenter calls it on air.
2. Under **Programme**, **Today**, add a rule to the format clock of kind `narration`, at the time you want it, about that series.

A `narration` rule must name a series. Unlike a `syndicated` rule, there is no "the next piece of anything": that would read chapter four of one book and then chapter one of another.

## Which piece is next

A series is carried in one of two ways, and the plugin says which.

- A **serial**, such as a book, takes the lowest-numbered piece the station has not read yet, and it does reach back. A chapter published years ago is next if the station has not got to it. The station's place in a book is what it has aired, not the calendar.
- A **column**, such as a newsletter, takes the newest piece and nothing else. On a week nothing was published, the rule is passed over and the station goes on with ordinary programming rather than reading last week's issue again.

Either way, a piece is read once. The station marks it as it airs, and that mark is its place in the book.

## It is spoken hours before it airs

Six hours before the rule's time, the station starts speaking the piece: several takes on its own engine, joined into one piece of audio by the analyzer. It is done at a lower priority than everything the presenter needs, so a break planted while a chapter is being read waits for one take rather than the whole chapter.

The reader is the station's **default host**, not whoever is presenting at the time. The reading is made hours ahead of its slot, on whatever show happens to be on then, so reading it in the current show's voice would give chapter three one voice and chapter four another. A series has one reader.

A piece can be asked for early: **Read it now** on the Readings tab. It is ready to air once the station has spoken it.

## On air

A reading airs whole, with a talk break in front of it where your station hands over, so the presenter introduces it. The break is shown the series, the piece and what it is about.

Players and listener apps show the piece's title with the series' name beside it, as they would a record and its artist, and its artwork where the series has some. It is not counted as a record: it does not affect what the station plays next, and it is not scrobbled.

The station's clock counts the reading's length, so a bulletin at the top of the next hour lands after it rather than inside it. A rule due while a reading is playing has no boundary near its time and is passed over, as it would be behind any long item. Where the mixer reported a length the station uses that; where it did not, it projects one from the word count at about 180 words a minute, which is roughly what the station reads at.

A reading is still carried when the station's breaks are switched off. Turning breaks off stops the station talking; it says nothing about a programme you scheduled.

## The Readings tab

**Library**, then **Readings**, lists the pieces the station knows about and what it has done with each: not read yet, reading, ready to air, read, or could not read, with the reason. Each shows its series, where it comes in the series, when it was published and how many words it runs to. Filter by series with the picker at the top.

The station tries a failed reading three times on its own before it waits for you.

## When it declines the slot

The station passes the slot over and carries on with ordinary programming, rather than reading something else, when:

- The rule names no series, or the series has nothing left to read.
- The piece is not spoken yet, because the station was busy or the reading failed.
- There is no analyzer plugin to join the takes into one item. A reading cannot air as its separate parts, so it does not air at all. The reason is on the piece in the Readings tab, which is the only place it is visible.

There is no way to rewind a serial and have it read a chapter again. Adding the series afresh is the way round it for now.
