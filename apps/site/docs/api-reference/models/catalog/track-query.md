---
title: 'TrackQuery'
sidebar_position: 24
mdx:
    format: 'md'
---

> A track list, narrowed by what the station has of each record as well as by name.
>
> Its own contract rather than a field on `CatalogQuery`, because that one is shared with the artist
> and album lists where none of these states means anything.

Extends [`CatalogQuery`](./catalog-query.md)

<details>
<summary>Attributes (4)</summary>

| Attribute        | Type             | Required | Description                                                                                                               |
| ---------------- | ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `state`          | `TrackState`     | No       |                                                                                                                           |
| `sortBy`         | `TrackSort`      | No       |                                                                                                                           |
| `analyzer`       | `string`         | No       | Only records this analysis plugin measured, or tried to and failed. The selector for measuring a detector's records again |
| `measureFailure` | `MeasureFailure` | No       | Only records whose measurement failed this way                                                                            |

</details>
