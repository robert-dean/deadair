---
title: 'RequestableTrack'
sidebar_position: 2
mdx:
    format: 'md'
---

> A record the station could be asked for: one it holds, or one a music provider carries

<details>
<summary>Attributes (7)</summary>

| Attribute    | Type                | Required | Description                                                                                                                |
| ------------ | ------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `trackId`    | `string`            | No       | What to send as `trackId` to make the request. Absent for a record from a provider, which is asked for by `source` instead |
| `source`     | `RequestableSource` | No       | Where a record the station does not hold yet comes from. Send it as `source` to ask for it                                 |
| `sourceName` | `string`            | No       | The provider, as the station names it, for a record from one                                                               |
| `title`      | `string`            | Yes      |                                                                                                                            |
| `artist`     | `string`            | Yes      | The lead artist                                                                                                            |
| `album`      | `string`            | No       |                                                                                                                            |
| `year`       | `number`            | No       |                                                                                                                            |

</details>
