---
title: 'StationHeartbeat'
sidebar_position: 10
mdx:
    format: 'md'
---

> One loop the station runs, and when it last came round.
>
> Two timestamps and no verdict, because the loop cannot supply one: a five-second reconcile and a
> nightly sweep are both healthy and no single threshold describes both. `Heartbeat` itself takes
> this position — it answers how long it has been and lets the reader decide — and a `stalled`
> boolean here would be this module inventing the threshold that file deliberately refuses to.
>
> `lastBeat` is absent until a loop finishes its first pass, which is why `startedAt` is there: from
> the two of them a reader can tell a loop that has never completed anything from one that stopped.

<details>
<summary>Attributes (3)</summary>

| Attribute   | Type     | Required | Description                                                                     |
| ----------- | -------- | -------- | ------------------------------------------------------------------------------- |
| `name`      | `string` | Yes      | _read-only_                                                                     |
| `startedAt` | `string` | Yes      | When the loop registered, which is when it was last (re)started. _read-only_    |
| `lastBeat`  | `string` | No       | When it last completed a pass. Absent until it completes its first. _read-only_ |

</details>
