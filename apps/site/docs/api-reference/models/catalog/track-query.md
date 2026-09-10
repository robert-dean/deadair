---
title: 'TrackQuery'
sidebar_position: 16
mdx:
    format: 'md'
---

> A track list, narrowed by what the station has of each record as well as by name.
>
> Its own contract rather than a field on `CatalogQuery`, because that one is shared with the artist
> and album lists where none of these states means anything.

Extends [`CatalogQuery`](./catalog-query.md)

<details>
<summary>Attributes (2)</summary>

| Attribute | Type         | Required | Description |
| --------- | ------------ | -------- | ----------- |
| `state`   | `TrackState` | No       |             |
| `sortBy`  | `TrackSort`  | No       |             |

</details>
