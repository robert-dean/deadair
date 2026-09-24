---
title: 'List station playlists'
sidebar_label: 'List station playlists'
sidebar_position: 7
mdx:
    format: 'md'
---

Every playlist the station owns, newest first

**`GET`** `/station-playlists`

:::note
SDK method: `listStationPlaylists`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [StationPlaylistList](../models/playlists/station-playlist-list.md) object.
