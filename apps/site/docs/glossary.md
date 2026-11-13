---
title: 'Glossary: the radio words the station uses'
sidebar_label: Glossary
description: What the console means by a block, a break, the format clock, a mount and the rest of the radio vocabulary, in a sentence or two each, with a link to the page that explains it.
toc_max_heading_level: 2
---

# Glossary

The console borrows its words from radio, because a station is what it runs. If you have never
worked in one, a few of them are not obvious, and some mean something a little narrower here than
they do in a studio. Each entry is a sentence or two and links to the page that explains it in full.

## A

### As run

What actually went out, item by item, with when each started and how long it ran. Where the running
order is the plan, the as-run log is the record. It is under **Check-up**, **As run**. See
[the check-up](./features/check-up.md).

## B

### Banter

A few minutes of a show's co-hosts trading lines with each other, made as one piece of audio. A show
with co-hosts gets one every half hour or so. See
[banter between co-hosts](./features/phone-ins.md#banter-between-co-hosts).

### Bed

What the audio chain plays on its own when the station is not feeding it the running order. The
check-up and the as-run log both say when the bed was on air. Not the same as a recording of the kind
`bed`, which the station plays from its running order while it waits for a [hard marker](#hard-marker).

### Blend

The overlap where one record fades out as the next fades in, sometimes called a crossfade. The station
sizes each one from the measurements of both records, and never fades a record into speech. See
[measuring each record](./features/library.md#measuring-each-record).

### Block

A named stretch of time on chosen days, such as breakfast, weekdays, six until ten. A block says what
to play, who hosts, and a brief. Blocks make up the timetable. See
[the programme](./features/programme.md#the-timetable).

### Break

Anything the station says between records: a talk break, a welcome, a news bulletin, the weather, a
piece of trivia, a presenter's story. See [breaks](./features/breaks.md).

### Brief

What you want a show to be, in your own words, such as "heavy metal hits". A model reads it when it
chooses records and writes breaks. It steers rather than fences in: to hold a show to a fixed set of
records, give it a playlist. See [the brief and the period](./features/programme.md#the-brief-and-the-period).

### Bulletin

A short news read from the station's feeds, usually on the hour or the half hour. See
[bulletins](./features/breaks.md#bulletins).

## C

### Caller

A character who rings in to a phone-in. A caller never presents. See
[callers](./features/phone-ins.md#callers).

### Character

A presenter, caller, guest or newsreader: a sheet saying who they are and how they speak, and a voice
to speak in. The API calls a character a **persona**. See [characters](./features/characters.md).

### Check-up

The page at the foot of the console's navigation that says, in one sentence, why the station is or is
not on air, and what to do about it. See [the check-up](./features/check-up.md).

### Co-host

A presenter who shares a show with its host, every night, on fixed nights, or now and then as a
visitor. Talk breaks go round the presenters. See [co-hosts](./features/programme.md#co-hosts).

### Cue points

Where a record's sound really starts, where its intro ends, where its ending begins and where the
sound stops. The station measures them for each record, trims the silence and knows how long a
presenter may talk over an intro. See [measuring each record](./features/library.md#measuring-each-record).

## D

### Dedication

Who a request is for, and a short message, which the presenter says in their own words just before
the record. See [requests](./features/programme.md#requests).

### Desk

The console's first page: what is on air, what needs you, and the running order. See
[the console](./features/console.md).

## E

### Encoder

A program on another machine that sends your voice, or anything else, to the station's live input so
you can go live. See [going live](./features/live.md).

## F

### Feature

A show of one artist, or one album played in full. It is one of the three modes, and like a setlist it
takes no breaks. See [modes](./features/programme.md#modes).

### Floor

The station's own phrasings, which write a break whenever the model declines, fails or takes too long.
They need no model and no network, so a break never goes unsaid for want of one. See
[two writers, and a floor](./features/breaks.md#two-writers-and-a-floor).

### Format clock

The rules for what the station says inside the hour: news at half past, the weather at seven, a
phone-in every couple of hours. A single rule on it is sometimes called a **band**. Radio stations
traditionally draw this as a clock face, hence the name. See
[the format clock](./features/programme.md#the-format-clock).

## G

### Guest

A character who drops by the studio for a short chat with the host. The chat is called a **visit**.
See [guests in the studio](./features/phone-ins.md#guests-in-the-studio).

### Guest host

A host who sits in for a block's usual host on some nights, and says whose show it is. See
[guest hosts](./features/programme.md#guest-hosts).

## H

### Hard marker

A rule on the [format clock](#format-clock) switched to **On the dot**: it airs exactly at its time,
fading out the record in its way when the music runs late and waiting behind a `bed` recording when it
runs early. A rule without the switch is a soft marker and airs when the record playing at its time
finishes. See [on the dot](./features/programme.md#on-the-dot).

### Handed over

A row in the running order that the player already holds. It has not aired yet, but it can no longer
be moved or removed. See [what each row tells you](./features/running-order.md#what-each-row-tells-you).

### HLS

A form of the stream made of short downloads rather than one long connection, so a phone moving from
wifi to mobile data keeps playing. See [the mount](./features/listening.md#the-mount).

### Host

The character presenting a show. **Presenter** means the same thing.

## I

### Ident

A short recording that identifies the station, uploaded on **Voice**, **Segments**. A jingle is the
same idea; an ident is always a recording. See [the format clock](./features/programme.md#what-a-rule-can-say).

## J

### Jingle

A few seconds of the station saying its own name between records, from a recording if you have one
and in the presenter's voice if not. See [jingles](./features/breaks.md#jingles).

## L

### Link

A talk break: the presenter talking between two records about the music on either side.

### Live input

The address an encoder sends to when you take the air yourself. See [going live](./features/live.md).

## M

### Mode

How a block treats its records. A **rotation** is the station programming for itself, a **setlist**
is a sequence somebody made, and a **feature** is one artist or one album. See
[modes](./features/programme.md#modes).

### Mount

The stream's address, such as `/live.mp3`. Everybody connected to a mount hears the same thing at the
same moment. See [the mount](./features/listening.md#the-mount).

## N

### Newsreader

A character who reads every news bulletin, whoever is hosting. A station has at most one. See
[characters](./features/characters.md#the-sheet).

## O

### Occasion

A day your presenters know about, such as Halloween or New Year's Eve, which they mention now and
then. See [occasions](./features/programme.md#your-opinion-and-the-rules-nothing-gets-round).

### Outro

The end of a record, after the last sung word. A short enough link can be said over it. The start of
a record before the singing is its **intro**.

## P

### Period

A range of years a show's records come from. Unlike a brief it is numbers, so every way of choosing a
record honours it. See [the brief and the period](./features/programme.md#the-brief-and-the-period).

### Persona

What the API and its tools call a [character](#character).

### Phone-in

A short programme in which a caller rings in and trades turns with the host, each turn written and
spoken separately, then joined into one piece before it airs. See [phone-ins](./features/phone-ins.md).

### Phrasings

Lines with placeholders that the station says when no model writes a break: each character's own, and
the station's for the news, the weather, jingles and the rest. They are the floor. See
[writing phrasings](./features/characters.md#writing-phrasings).

### Playout

The part of the station that hands the running order to the audio chain and keeps it on air.
**Settings**, **Playout** is where you choose when the station airs.

### Production

Anything the station makes with more than one turn or longer than a break: a phone-in, a visit, a
banter, a programme of its own. They are listed under **Voice**, **Productions**. See
[other productions](./features/phone-ins.md#other-productions).

### Programme

What the station plays across the day (the timetable) and what it says inside the hour (the format
clock). It is also the console page that holds both. See [the programme](./features/programme.md).

## R

### Reading

A book or column read out on air a piece at a time, spoken in the station's voice hours before it
airs. The API calls it a **narration**. See [readings](./features/narrations.md).

### Rotation

The station choosing records for itself, under rules that keep a record or an artist from coming
round again too soon. It is the usual mode. See [modes](./features/programme.md#modes).

### Running order

What the station will play and say, in order, from now to several hours ahead. You can read it and
change it on the Desk. See [the running order](./features/running-order.md).

## S

### Segment

A recording you upload for the station to play, such as an ident, a jingle or a sponsor spot. They are
under **Voice**, **Segments**.

### Setlist

A sequence of records somebody made, played in order. It is one of the three modes, and takes no
breaks unless you tick **Host talks between records**. See [modes](./features/programme.md#modes).

### Smart shuffle

A lean away from records that aired lately, so the station works through more of your library before
it repeats. It is on by default. See [how a pick is made](./features/programme.md#how-a-pick-is-made).

### Soundboard

A character's own short sounds, such as a sting or a laugh, which they can drop into a break. A single
sound is a **pad**. See [the soundboard](./features/characters.md#the-soundboard).

### Special

A block on dates rather than every week, such as Halloween night. It takes over from the timetable
for its hours. See [specials](./features/programme.md#specials).

### Sustaining

What plays in the hours no block claims. A schedule does not have to cover the day. See
[the timetable](./features/programme.md#the-timetable).

### Syndicated

A podcast somebody else made that the station carries, airing its newest episode at a time you
choose. See [podcasts](./features/podcasts.md).

## T

### Talk break

The ordinary break: the presenter talking between two records about the music on either side. Also
called a **link**.

### Tally

The line in the console's header that says whether the station is on air and how many are listening,
named after the light over a studio door.

### Timetable

The week of blocks: what plays when, and who hosts it. It is under **Programme**, **Timetable**. See
[the timetable](./features/programme.md#the-timetable).

## V

### Visit

A short programme in which a guest drops by the studio and talks with the host. See
[guests in the studio](./features/phone-ins.md#guests-in-the-studio).

### Voice

The speech engine and voice a character speaks in. It is also the console page that holds the
characters, their voices and everything they say. See
[models and voices](./features/models-and-voices.md).
