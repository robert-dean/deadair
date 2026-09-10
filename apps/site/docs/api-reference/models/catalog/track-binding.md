---
title: 'TrackBinding'
sidebar_position: 6
mdx:
    format: 'md'
---

> One provider's copy of a record, with whatever the station holds of it.
>
> PER BINDING and never per track, which is the rule the whole page is built on: one canonical
> record may bind to several copies inside one provider, those copies are different files with
> different loudness and different cue points, and the one that airs is the one that was resolved.
> Collapsing them would make "clear the audio" ambiguous about which file it took.
>
> The failure columns are here rather than hidden because that is the question this page exists to
> answer. A row with `attempts` and no `fetchedAt` is a remembered failure, and `lastError` with
> `nextAttemptAt` is the whole of why a perfectly good-looking record will not play.

<details>
<summary>Attributes (15)</summary>

| Attribute       | Type      | Required | Description                                                                                     |
| --------------- | --------- | -------- | ----------------------------------------------------------------------------------------------- |
| `sourceId`      | `string`  | Yes      | `track_sources.id`, which is also what the audio URL carries. _read-only_                       |
| `pluginId`      | `string`  | Yes      | _read-only_                                                                                     |
| `externalId`    | `string`  | Yes      | _read-only_                                                                                     |
| `playable`      | `boolean` | Yes      | False when the provider still knows the record but will not serve it here. _read-only_          |
| `missingAt`     | `string`  | No       | When the station gave up on this copy. Cleared by the next sync that sees it again. _read-only_ |
| `origin`        | `string`  | Yes      | `sync` if a playlist walk saw it, `discovered` if something looked it up. _read-only_           |
| `bitrate`       | `number`  | No       | _read-only_                                                                                     |
| `format`        | `string`  | No       | _read-only_                                                                                     |
| `lastSeenAt`    | `string`  | No       | _read-only_                                                                                     |
| `byteSize`      | `number`  | No       | What the station holds of this copy, absent when nothing has ever fetched it.. _read-only_      |
| `fetchedAt`     | `string`  | No       | _read-only_                                                                                     |
| `lastServedAt`  | `string`  | No       | _read-only_                                                                                     |
| `attempts`      | `number`  | Yes      | CONSECUTIVE failures. Reset by a fetch that works. _read-only_                                  |
| `lastError`     | `string`  | No       | _read-only_                                                                                     |
| `nextAttemptAt` | `string`  | No       | _read-only_                                                                                     |

</details>
