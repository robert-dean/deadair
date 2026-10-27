---
title: Recordings
sidebar_position: 11.6
description: Keeping an MP3 of what the station airs, every live show or everything on air, to listen back to, download, or cut clips from.
---

The station can keep a recording of what it airs: one MP3 for every live show, named after it, or everything that goes out, an hour to a file. Recordings are kept on the station's own disk, listed on **Check-up → Recordings**, and swept after a number of days you choose.

## Switching it on

It is off until you choose what to keep, in **Settings → Stream → Record what airs**:

- **Live shows only.** One file per [live show](./live.md), from the moment you go on air to the hand-back, named after the show.
- **Everything on air.** That, and the station's own programme in hourly files.

Saving the setting restarts the audio engine, which is a few seconds of silence for anybody listening, so it is worth changing when nobody is.

**Nothing is recorded while the station is off the air.** A station set to air only while somebody is listening (the default) records its programme only then. A live show is always recorded, whether or not anybody is listening.

## Listening back

**Check-up → Recordings** lists them by day, newest first. A live show carries its name and a **Live** badge; an hour of the programme says so. The one being recorded right now is marked **Recording now** and grows as it goes.

- **Play** opens a player under the recording. You can skip anywhere in it, even in a show hours long, without waiting for the whole file to load.
- **Download** saves the whole MP3, named after the date and the show, ready for an editor.
- **Delete** asks for a second press, because a recording cannot be made again. One still being recorded cannot be deleted until it ends.

## How long they are kept

**Settings → Stream → Keep recordings for (days)** is two weeks to start with. Every night the station deletes the recordings that ended longer ago than that. Zero keeps every one until you delete it.

Recordings are 192 kbps MP3s, about 86 MB an hour. Live shows only takes little room; everything on air, around the clock, is about 2 GB a day. The console's disk figures count them as a line of their own.

## Where the files are

In the station's data directory, under `streamarchive`, a folder per day:

```
streamarchive/2026-10-27/21-03-12-live.mp3
streamarchive/2026-10-27/21-03-12-live.json
```

The `.json` beside each MP3 says what it is, the show's name, and when it began and ended. You can copy recordings straight off the disk; the station never needs them back.

Unlike the station's cache of records, nothing in this folder can be made again, so back it up if the shows matter to you. To keep recordings on other storage, mount a directory at `/data/streamarchive` (on Unraid, the **Archive** field in the template). See [Unraid](../unraid.md) for where the station keeps its data.
