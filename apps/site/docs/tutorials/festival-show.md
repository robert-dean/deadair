---
title: A show for a festival
description: Enter a festival's dates and bill, build a special around it that plays the acts on the bill, and let its host talk about the festival from the facts you saved, until it is over.
---

# A show for a festival

By the end of this page the station knows about a music festival: its name, its days, where it is and
who is on the bill. A special runs through the weeks before it and its weekend, playing the acts on
the bill, and its host talks about the festival using only what you entered. Once the festival is
over, the host stops mentioning it.

A festival is not a show. It is a set of facts on Programme's **Festivals** tab, and a show is built
around one by naming it. [Specials](../features/programme.md#specials) explains both in full.

**You need** a station on air with music, and a character to host the show
([Write a character](./write-a-character.md)). To play acts your library does not hold, the station
needs a plugin that can list an artist's top tracks: Deezer works with no key at all, and Last.fm,
MusicBrainz and Spotify do too. Looking the festival up instead of typing it needs the
**Ticketmaster** plugin with a free API key ([Plugins](../features/plugins.md#the-bundled-twenty-seven)).

## 1. Add the festival

Open **Programme → Festivals**. Under **Add a festival**, fill in:

| Field | For this example |
| --- | --- |
| **Name** | `Harbour Lights`. Said on air exactly as written. |
| **Dates** | 11 to 13 June 2027. Pick one day for a one-day festival. |
| **Where** | `the harbour front, Bristol`, as the host should say it. Leave it empty and the host says nothing about where. |
| **Web page** | The festival's own page. It is a note of where the facts came from, and is never read out. |
| **Headliners** | One act per line. |
| **Everyone else on the bill** | One act per line. To give the day an act plays, end the line with a comma and the date: `Wet Leg, 2027-06-12`. |

Press **Add festival**. The festival appears in the list as **Coming up**, with a line such as "24 acts
on the bill, headlined by …".

**Everything the host says about it comes from this form**, so check the dates and the bill against
the festival's own page before you save.

### Or look it up

With Ticketmaster set up, type the festival's name into **Look it up** and press **Look up**. Pick the
right listing and press **Start from this** to fill the form. Then:

- **Move the headliners.** A ticket listing does not say who headlines, so every act lands in
  **Everyone else on the bill**. Move the headliners into **Headliners** yourself.
- **Check the dates.** A festival sold one ticket per day can show as several listings.
- **Then press Add festival.** The lookup fills the form and saves nothing; what airs is what you
  add.

## 2. Build a special around it

Open **Programme → Specials** and press **New special** (the fields are explained in
[A holiday special](./holiday-special.md)). For this festival:

| Field | For Harbour Lights |
| --- | --- |
| **Name** | `Harbour Lights Weekend` |
| **Starts at** / **Ends at** | `18:00` and `22:00`. |
| **Dates** | 24 May to 13 June 2027: the three weeks before, and the festival itself. |
| **Hosted by** | The character for the show. |
| **Asked to play** | `indie and guitar music in the spirit of the festival, upbeat and summery` |
| **Built around a festival** | `Harbour Lights`. |

Save. Only festivals that are not over are offered under **Built around a festival**.

A weekly show can be built around a festival too, but a special is the usual choice, because it ends
when the festival does.

## 3. Decide how much of each hour is the bill

By default 60% of each hour comes from the acts on the bill, and the rest follows the show's brief.
To change it, open **Settings → Rotation** and move **How much of a festival show comes from the
festival's bill**. At `0` the bill is left to the model and the brief alone.

The station works through the bill fairly: acts it has never played first, then the ones played
longest ago. Headliners get no more airtime than anybody else. Your dislikes, never-play rules and
the station's cooldowns still apply.

## 4. Listen

When the special is on, its records come from the bill, including acts your library does not hold
yet. Between them the host may say:

- the festival's name, where it is, and its dates, said as dates
- whether it is coming up or on now
- up to three headliners
- the day an act plays, when the record either side of the break is by someone on the bill with a day
  next to their name

It never mentions set times, prices or tickets, or anyone you did not put on the bill. A sentence that
gives the festival a date outside its days, or puts somebody on the bill who is not there, is refused
and the break is written again.

After the last day the festival shows as **Over**. The host stops talking about it, though a show
still built around it keeps playing the bill until the special ends.

## With Claude

With Claude connected and allowed to **Read and manage**
([how](./connect-a-model.md#connect-claude-if-you-want-it-too)):

> Look up the Harbour Lights festival, show me what you find, and once I confirm, add it with its
> headliners in their own list. Then make a special from 24 May to 13 June 2027, six until ten each
> evening, hosted by the indie host and built around it.

Claude has tools to list, add, look up, change and remove festivals, and names a festival on a show
the same way the editor does.

## If it goes wrong

- **The festival will not save.** The console shows the reason: an end date before the start, a date
  that is not a real day, or an act whose day is not one of the festival's days.
- **Look it up finds nothing.** Ticketmaster has no key, or no festival by that name from today on.
  "Could not ask" names a plugin that failed. Either way, add it by hand.
- **The show plays nothing from the bill.** The bill is empty, the setting under Rotation is `0`, or no
  plugin can list an artist's top tracks. Add Deezer, which needs no key.
- **The host never mentions it.** It is over, or the show is not built around it: check **Built around
  a festival** in the show's editor.
- **The host got a fact wrong.** It said what you entered. Edit the festival with the pencil beside it
  on the Festivals tab, and the next break uses the new facts.

## Next

- [A holiday special](./holiday-special.md), for the rest of what a special can do.
- [Give a show its own sound](./show-sound.md), to give the festival show its own jingles and beds.
