---
title: 'Play a playlist'
sidebar_label: 'Play a playlist'
sidebar_position: 2
mdx:
    format: 'md'
---

Loads a plugin playlist into the running order and starts handing it to the player. Replaces whatever was queued; what is on air finishes rather than being cut off

**`POST`** `/playout/playlist`

:::note
SDK method: `playAPlaylist`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [PlayoutPlaylistInput](../models/playout/playout-playlist-input.md) object.

## Response

`200 OK` — Returns a [PlayoutStatus](../models/playout/playout-status.md) object.
