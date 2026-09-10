---
title: 'HistoryEntry'
sidebar_position: 1
mdx:
    format: 'md'
---

> One record the station actually played

<details>
<summary>Attributes (8)</summary>

| Attribute    | Type     | Required | Description                                                                                                                                                               |
| ------------ | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | `string` | Yes      | Unique across the history, and half of the cursor below                                                                                                                   |
| `airedAt`    | `string` | Yes      | When it started, written when it began rather than when it was handed to the player                                                                                       |
| `title`      | `string` | Yes      |                                                                                                                                                                           |
| `artists`    | `string` | Yes      | The credit as written, whole: one line rather than a list, because that is the shape a release credits itself in and splitting it renames acts with a comma in their name |
| `album`      | `string` | No       | Absent for anything aired straight from a provider, which the catalog holds no record for                                                                                 |
| `artworkUrl` | `string` | No       | The station's own copy where it has one, as a path under the API root, and the upstream URL until then. Resolve it against the base the station is reached at             |
| `durationMs` | `number` | No       | How long the recording runs, from the catalog rather than from the copy that played                                                                                       |
| `trackId`    | `string` | No       | The catalog track this was, for a client that wants to ask more about it. Absent for a record the catalog does not hold, and for one it has since forgotten               |

</details>
