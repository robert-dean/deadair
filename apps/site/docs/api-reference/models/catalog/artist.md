---
title: 'Artist'
sidebar_position: 3
mdx:
    format: 'md'
---

> The canonical work, not a binding to a provider. `deadair.artists` minus the columns that
> only ingest cares about: `artist_key` is a match key, and a row with `merged_into_id` set is
> never read out at all.
>
> `imageUrl` on both contracts below is always a path under the API root, never a provider's URL:
> `art/<uuid>` for the station's cached copy, or `art/source/<token>` for one it has not cached
> yet, which the station fetches on first ask and serves as its own. Resolve either against the
> API base the client already configures (the API mounts at the root and does not know the `/api`
> prefix the edge adds). The switch from the second to the first happens server-side.

<details>
<summary>Attributes (7)</summary>

| Attribute    | Type     | Required | Description                                                                       |
| ------------ | -------- | -------- | --------------------------------------------------------------------------------- |
| `id`         | `string` | Yes      | _read-only_                                                                       |
| `name`       | `string` | Yes      |                                                                                   |
| `mbid`       | `string` | No       | MusicBrainz artist id, absent until enrichment resolves one                       |
| `imageUrl`   | `string` | No       | An API-relative path: the cached copy, or the station's proxy for an uncached one |
| `rating`     | `Rating` | Yes      | _default: `neutral`_                                                              |
| `albumCount` | `number` | Yes      | Unmerged albums credited to this artist. _read-only_                              |
| `trackCount` | `number` | Yes      | Unmerged tracks credited to this artist. _read-only_                              |

</details>
