---
title: 'TrackDetail'
sidebar_position: 9
mdx:
    format: 'md'
---

> Everything one record has accumulated, in one read.
>
> The enrichment is deliberately NOT here. It has its own operation already, answering
> `TrackEnrichmentDetail` with every provider's payload and the station's own sourced claims, and
> the console draws it through the same panel the list uses. One enrichment shape rather than two.

Extends [`Track`](./track.md)

<details>
<summary>Attributes (4)</summary>

| Attribute   | Type             | Required | Description                                                                  |
| ----------- | ---------------- | -------- | ---------------------------------------------------------------------------- |
| `bindings`  | `TrackBinding[]` | Yes      |                                                                              |
| `analysis`  | `TrackAnalysis`  | No       | Absent for a record the walk has not reached                                 |
| `plays`     | `TrackPlay[]`    | Yes      | The most recent airings, newest first                                        |
| `playCount` | `number`         | Yes      | How many times in all, which the list above is only the head of. _read-only_ |

</details>
