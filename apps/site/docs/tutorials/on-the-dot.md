---
title: Make the news start on the dot
description: Switch a format clock band to On the dot, so the hourly news starts exactly on the hour, waiting behind a music bed when the records run early and fading the record out when they run late.
---

# Make the news start on the dot

By the end of this page the station's hourly news starts at exactly the top of the hour. When the
records run early, the station waits for the hour behind a music bed. When they run late, it fades
out the record in the way.

Normally a band on the [format clock](../features/programme.md#the-format-clock) airs when the record
playing at its time finishes, so the news at the hour can be a few minutes late. A band set to
**On the dot** is a hard marker: it airs at its time, never before it.
[On the dot](../features/programme.md#on-the-dot) explains it in full.

**You need** a station with a news band on the format clock
([News and weather](./news-and-weather.md#5-put-them-on-the-format-clock)). For the station to wait
when it is early, it needs at least one music bed at least a minute and a half long
([Give a show its own sound](./show-sound.md#1-upload-the-recordings)). Without one it can still fade
out a record that runs late.

## 1. Switch the band on the dot

Open **Programme → Today** and find **Format clock**. Click the news band to open **Edit band**. It
says a `news` break **every hour at** `0` **Minutes past the hour**.

Switch **On the dot** on, and press **Save**.

The band now shows "on the dot" under its time in the clock list. Only a band at a time of day offers
the switch: one set to **every** so many minutes has no time to hit.

Saving changes nothing already planned. The band takes its next hour on the station's next pass, a
few minutes later.

## 2. Set how far it may go

Open **Settings → Breaks**:

| Setting | Default | What it does |
| --- | --- | --- |
| **Seconds a hard marker may cut** | 120 | The most of a record that may be faded out to make the time. `0` never cuts. |
| **Seconds a hard marker may wait** | 60 | The longest the station waits behind a bed. `0` never waits. |

Where it could either wait or cut, the station takes whichever moves the music less.

## 3. Listen at the hour

Listen across the top of the hour.

- **Records running late:** the record playing at the hour fades out over about three seconds and the
  news starts on the hour.
- **Records running early:** the record before the news ends, a music bed starts, and it fades out as
  the news starts on the hour.

## When it does not wait or cut

The band airs when the record in front ends, just as it would without the switch, when:

- the cut would be longer than **Seconds a hard marker may cut**
- the record in front has played for less than half a minute
- the station is speaking in front of it, because talk is never cut
- it would have to wait longer than **Seconds a hard marker may wait**
- no bed is at least half a minute longer than the wait

## With Claude

With Claude connected and allowed to **Read and manage**
([how](./connect-a-model.md#connect-claude-if-you-want-it-too)):

> List the format clock, then make the news on the hour start on the dot.

## If it goes wrong

- **The news started a little early.** A record just before it was skipped or taken out after the
  plan was made, and the station cannot stretch what is left. The log says so.
- **It never waits, only cuts or airs late.** There is no bed long enough. Upload a longer one with the
  kind `bed`.
- **It still airs a few minutes late.** The record in front would have had to lose more than the cut
  limit, or had only just started. Raise **Seconds a hard marker may cut**, or accept a late hour now
  and then.
- **Nothing changed.** Give it a few minutes: the band claims its next hour on the next pass. Check
  that it shows "on the dot" and **In force** is on.

## Next

- [Give a show its own sound](./show-sound.md): the bed a show waits behind is one of its own.
- [News and weather](./news-and-weather.md), for what the news says.
