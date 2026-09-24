---
title: 'Play a station playlist'
sidebar_label: 'Play a station playlist'
sidebar_position: 3
mdx:
    format: 'md'
---

Loads a playlist the station owns into the running order and starts handing it to the player. The same replacement a plugin playlist makes, from records the library already holds

**`POST`** `/playout/station-playlist`

:::note
SDK method: `playAStationPlaylist`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [PlayoutStationPlaylistInput](../models/playout/playout-station-playlist-input.md) object.

## Response

`200 OK` — Returns a [PlayoutStatus](../models/playout/playout-status.md) object.
