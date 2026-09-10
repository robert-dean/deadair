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
> `imageUrl` on both contracts below is one field with two spellings. An absolute URL is the
> provider's own, still hotlinked because nothing has cached it yet; a relative `art/<uuid>` is
> the station's copy, to be resolved against the API base the client already configures (the API
> mounts at the root and does not know the `/api` prefix the edge adds). Prefer the local one by
> doing nothing: the switch happens server-side as soon as the art cache pass has the bytes.

<details>
<summary>Attributes (7)</summary>

| Attribute    | Type     | Required | Description                                                      |
| ------------ | -------- | -------- | ---------------------------------------------------------------- |
| `id`         | `string` | Yes      | _read-only_                                                      |
| `name`       | `string` | Yes      |                                                                  |
| `mbid`       | `string` | No       | MusicBrainz artist id, absent until enrichment resolves one      |
| `imageUrl`   | `string` | No       | Absolute upstream URL, or an API-relative path to the local copy |
| `rating`     | `Rating` | Yes      | _default: `neutral`_                                             |
| `albumCount` | `number` | Yes      | Unmerged albums credited to this artist. _read-only_             |
| `trackCount` | `number` | Yes      | Unmerged tracks credited to this artist. _read-only_             |

</details>
