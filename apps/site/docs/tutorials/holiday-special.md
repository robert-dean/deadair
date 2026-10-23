---
title: A holiday special
description: A Halloween night show that takes over from the weekly schedule for its hours, comes back every year on the same date, and hands back to the regular show when it ends.
---

# A holiday special

By the end of this page the station has a Halloween special: four hours on the night of 31 October
with its own brief and its own host, which takes over from whatever usually airs then, hands back
when it ends, and comes back every year without you touching it.

A special is a show on dates rather than every week. It has everything a weekly show has, plus a
first and a last date. [Specials](../features/programme.md#specials) explains them in full, and
[Make a show](./make-a-show.md) walks through the fields a special shares with a weekly show.

**You need** a station on air with music, and a character to host the night
([Write a character](./write-a-character.md)). The brief reads best with **Let a model choose what
plays** on under Settings → Words ([Give the station a model](./connect-a-model.md)).

## 1. Open a new special

Open **Programme → Specials** and press **New special**.

## 2. Fill it in

The editor is the weekly show's, with dates added. This one runs 20:00 to midnight on Halloween,
which on the station this site is written from lands in the middle of The Boneyard, its weeknight
metal show:

| Field | For Halloween night |
| --- | --- |
| **Name** | `Halloween Night` |
| **Starts at** / **Ends at** | `20:00` and `00:00`. An end before the start runs past midnight. |
| **Dates** | 31 October to 31 October, this year. |
| **Repeats every year** | On. The year you picked is ignored, and it comes back every 31 October. |
| Days | None. No day chosen means every day of the range, which here is one day. |
| **Playing from** | Leave it empty, so the station chooses against the brief. Or pick a playlist to play exactly that. |
| **Hosted by** | The character for the night. |
| **Asked to play** | `spooky and theatrical: horror-film themes, monster novelty records, gothic rock, and the darkest of metal; fun rather than grim` |

Save.

**Specials can share a day with the weekly schedule.** On 31 October the special takes over for its
hours: The Boneyard plays until eight, then the special runs until midnight. The Boneyard would have
ended at ten, so there is nothing left of it to come back to. A special that ended at nine would hand
back to The Boneyard for its last hour, part-way through. Every other night of the year is untouched.

Two specials cannot overlap each other. A special overlapping a weekly show is the point of one.

## 3. Check it

**Programme → Timetable** draws the special on its date, named as a special, with the weekly shows
trimmed around it. Its times can be dragged there; its date cannot. **Programme → Specials** lists it,
with the specials on today first, then the soonest.

At eight on the night, the station hands over between records as it does at any change of show, and
the new host thanks the last one.

## More than one night

A special's dates are a range, and the days you tick still apply inside it:

- **The week before Christmas**: 18 to 24 December, every day, repeating every year.
- **The Fridays in December**: 1 to 31 December with only Friday ticked.
- **New Year's Eve into New Year's Day**: a yearly range can run past New Year, such as 31 December to
  1 January.
- **A one-off**: leave **Repeats every year** off, for an evening somebody else presents.

## With Claude

With Claude connected and allowed to **Read and manage**
([how](./connect-a-model.md#connect-claude-if-you-want-it-too)):

> Make a Halloween special on 31 October from eight until midnight, every year, hosted by the
> late-night host. Write it a spooky, theatrical brief that is fun rather than grim. Show me what you
> will create first.

## If it goes wrong

- **The special will not save.** It overlaps another special. Move one of them.
- **It did not air.** Check the station's clock: **Station timezone** under Settings → Station decides
  what "20:00 on 31 October" means.
- **A seasonal rule kept its records off.** A [never-play rule](../features/programme.md#your-opinion-and-the-rules-nothing-gets-round)
  that holds on its dates still applies, playlist or not. Limit the rule's season so it lifts for the
  special.
- **The weekly show did not come back at midnight.** It only resumes if its own hours run past the
  special's end. Nothing is broken: the timetable shows what is due next.

## Next

- [Two recurring shows](./recurring-shows.md), for the shows a special takes over from.
- [The programme](../features/programme.md) for guest hosts and co-hosts, which a special can have
  too.
