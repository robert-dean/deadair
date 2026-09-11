---
title: The console
sidebar_position: 11
description: The broadcast desk you run the station from, how it is laid out, what it records about itself, and how you sign in to it.
---

The console is a broadcast desk rather than a player. It shows what is going out, what needs you and what is coming, and it deliberately does not play the station: listeners use the stream itself, or the Android and desktop apps (see [listening](./listening.md)). Everything you do in it acts on the one broadcast every listener hears, which is why its button says Air this playlist rather than Play.

![The activity feed: what the station has done, newest first](/img/console/activity.webp)
*Fig. 1. What it has been doing.*

## Where things are

A rail down the left carries four destinations, each with its sections listed beneath it:

- **Desk**: what is on air now, what needs you, and the running order, with Skip and Stop beside the thing they act on. See [the running order](./running-order.md).
- **Programme**: Today, the Timetable across the week, and Sustaining, what plays when nothing is scheduled. See [the programme](./programme.md).
- **Library**: Tracks, Artists, Playlists, Charts and News. See [the library](./library.md).
- **Voice**: Characters, Auditions, Voices, Segments, Pronunciations, Soundboard, Subjects, Productions, and What it said. See [characters](./characters.md).

Below a rule sit **Check-up**, for what is wrong right now (see [the check-up](./check-up.md)), and **Settings**.

The header carries the tally: whether the station is on air, how many are listening, and on which mount. It sits in the chrome for the reason a studio puts the tally over the door: every page needs it and no page owns it.

## Moving around by keyboard

The four destinations have keys: D, P, L and V. They do nothing while you are typing in a field or have a dialog open, so a letter never navigates away from unsaved work.

⌘K (Ctrl+K off a Mac) opens Jump to anything: every destination, section and settings page, listed as soon as it opens. Type two characters or more and it also searches records, artists and characters by name.

## What it has been doing

Check-up → What it has been doing is the activity feed: newest first, what aired, what the station wrote and spoke, and every moment a gate opened or closed on it. Filter by where a line came from (Playout, Programming, Breaks, Catalog, Plugins), or to warnings and faults, the only lines drawn in colour. A station idling on purpose for want of a listener writes an ordinary line, because it is not a fault. A line about a record or a break links to it.

## What it cost

Check-up → What it cost lists every call the station made, filed under the decision that made it: when, how long it took, how many calls, and how many failed. A decision that set off another is drawn indented beneath it, so a job and the work it queued read as one story. Open a decision to see each call, with details such as tokens where they were recorded. Each call is written as it ends, so one that timed out is still here with what it cost. The station keeps a few days of these.

## Three themes

Settings → Appearance offers three ways to read the same console:

- **Carbon**: the studio at night, phosphor green on carbon.
- **Studio White**: daylight and paper, rules instead of fills.
- **Neon Transmitter**: neon yellow on teal-black, lit cyan and magenta. The loudest of the three.

The choice is remembered on that browser and changes nothing about the station. The tally stays red in all three, because it is the one colour that means the same thing in every room.

![Settings, Appearance: the three themes, each drawn in its own colours](/img/console/settings.appearance.webp)
*Fig. 2. Appearance.*

## On a phone

On a narrow screen the rail becomes a bar across the bottom with the four destinations, one thumb-sized tap each. Check-up, Settings and Logout sit behind the menu in the top corner, beside a search button for Jump to anything. Most tables become cards rather than scrolling sideways, so a control you need is never off the edge of the screen.

## Signing in

**Settings → Security** is how you sign in. Enrol an authenticator app (Google Authenticator, 1Password, Aegis, anything that shows six-digit codes) and every sign-in to that account asks for its code after the password. Remove the last one and sign-in goes back to the password alone. Either change asks for a fresh code first if yours is more than a few minutes old.

**Settings → Mail** makes the other half work. Point it at any SMTP server and the station can email a sign-in code as a second factor, and a sign-in link as a first: "Email me a sign-in link" on the sign-in page, no password at all. The link is the whole of the sign-in, so anybody who can read that message can get in. It works once, expires in half an hour, and should not be forwarded. An account with an authenticator is still asked for the code afterwards, because a link proves the inbox, which is one factor and not two.

Until a mail server is set, the station sends nothing and says so. It will not offer you an emailed code it cannot deliver, so a station with no mail signs you in on the password alone. If you lose your authenticator and have no mail either, [the project README](https://github.com/robert-dean/deadair#if-you-lose-your-authenticator) says how to get back in from the machine.

## In the console

The rail holds Desk, Programme, Library and Voice, with Check-up and Settings below the rule. The activity feed and the cost of each decision are under Check-up. Themes are Settings → Appearance; sign-in is Settings → Security and Settings → Mail.
