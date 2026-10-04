---
title: 'Play an album'
sidebar_label: 'Play an album'
sidebar_position: 4
mdx:
    format: 'md'
---

Plays an album the library holds, whole and in the order it was made: by disc, then by track. A feature, so no breaks and no blends between its records, and what is on air finishes rather than being cut off. It stops at the end of the album, or when the schedule's next block starts

**`POST`** `/playout/album`

:::note
SDK method: `playAnAlbum`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [PlayoutAlbumInput](../models/playout/playout-album-input.md) object.

## Response

`200 OK` — Returns a [PlayoutStatus](../models/playout/playout-status.md) object.
