---
title: 'SimilarityNode'
sidebar_position: 46
mdx:
    format: 'md'
---

> One artist in the similarity graph. Keyed by its folded name rather than an id, because most of
> the artists the sources name are not in the catalog at all.

<details>
<summary>Attributes (3)</summary>

| Attribute  | Type     | Required | Description                                                                                               |
| ---------- | -------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `key`      | `string` | Yes      | The artist's name as the station folds it for matching. Unique in one graph. _read-only_                  |
| `name`     | `string` | Yes      | The catalog's spelling when the catalog holds the artist, else the source's. _read-only_                  |
| `artistId` | `string` | No       | The catalog artist, when the catalog holds one. Absent for an artist only a source has named. _read-only_ |

</details>
