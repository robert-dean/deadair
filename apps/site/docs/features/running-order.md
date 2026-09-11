---
title: The running order
sidebar_position: 1
description: One forward lineup per station, with one writer, a state on every item, and a rule that no record is committed until its audio is on the machine.
---

The running order is what the station will play and say, in sequence, from the record on air now to several hours ahead. It is not a queue that gets topped up behind the listener. It is a lineup you can read and edit, and every item in it carries its own state, so the plan and what actually aired cannot disagree.

![The Desk: what is on air, what needs you, and the running order](/img/console/desk.webp)
*Fig. 1. The Desk, on air.*

## One writer

Exactly one part of the station writes the running order. The console, the schedule and the model each send it a request saying what they want and how soon, and it decides where that lands, because only it knows where the record boundaries are.

This is a rule rather than tidiness. Earlier versions let several things write the order, and each mechanism that reconciled them became a bug of its own. They were all the same fault, a second writer, so they were removed rather than fixed. The result is that an edit you make at 3pm is still true at 3.05.

## What each row tells you

Every row on the Desk says where it has got to:

- **Planned**: nothing has touched it yet. You can move it or drop it.
- **Handed over**: the player is holding it, so it can no longer be moved or removed. It has not aired: the player works ahead of the listener.
- **On air**: a listener is hearing it now.
- **Played**: heard, and behind the station.
- **Skipped**: reached and passed over, usually a break whose audio was not ready in time.
- **Unavailable**: a record the station could not get audio for. This is the one you can act on.
- **Removed**: you took it out. A dropped break stays in the order, marked, so the station does not plant another into the same gap. A dropped record is spliced out, and the Desk offers to put it back.

A break marked "not written yet" or "no audio yet" is normal. The station writes a break when its slot comes near, not when it plants it.

## A broadcast has an identity

When the station goes on air, the order is built from what you chose: a playlist, a chart, or nothing, in which case the station fills it itself. A playlist is read at that moment rather than copied, and nothing of yours is written into.

Each broadcast gets an identity that everything written during it carries, so "what happened during last night's show" has an answer. A restart mid-programme resumes the same broadcast rather than starting a second one.

The order also carries your brief, in your own words, and who is presenting. Every refill for the rest of the broadcast is programmed against that brief rather than drifting back to ordinary rotation; [the programme](./programme.md) explains how. You can change the host without starting a new show, and the outgoing host's unaired breaks are written again under the new one. A script you typed yourself, or a voice you set by hand, is left alone.

## Nothing airs until its bytes are here

A record is committed to the player only once its audio is on this machine, so when its turn comes, playing it is a local read rather than a download started in the gap. That gap used to be audible: two seconds of digital silence while a provider answered.

The station stops at the first record whose audio has not arrived rather than skipping past it, so a slow download never reorders a sequence you built. A record still downloading is held, where a break that is not ready is skipped: a break is disposable and a record is not. And if the station cannot tell what has downloaded, it lets the record through rather than going off air over a passing database fault.

A record nothing will serve comes out before its slot, marked unavailable, and the order is refilled behind it. After four consecutive failed fetches the station benches that copy, until the hourly library sync sees the provider still listing it.

Every record fetched is kept, up to a cap if you set one. Because the audio is local, the player holds only one record ahead, so an edit lands on the next record rather than three later.

A station just put on air may have nothing downloaded yet. The console reads "warming up" while downloads are in flight, which is never a fault, and "records not here" only if they have stopped. A listener arriving meanwhile hears the station say so.

## When it runs out

Each broadcast says what happens at the end: keep going, start again, or stop. On "keep going" the station tops the order up once fewer than eight items are left. The Desk shows roughly what time the order runs dry and what happens then, with **Extend now** beside it for a refill without waiting.

## In the console

**Desk** is the running order. The top panel shows what is on air, who put it there, its brief and its host, with **Skip** and **Stop** (Stop needs a second press). Click the host's name to recast. Below are **Needs you** and the order, where you can move, drop and rate rows. **Plan** either replans this show's tail against a new brief or starts a new show. **Shuffle** reorders everything the player is not already holding. The cap on kept records is under **Settings**, **Playout**.
