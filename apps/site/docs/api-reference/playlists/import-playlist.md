---
title: 'Import playlist'
sidebar_label: 'Import playlist'
sidebar_position: 14
mdx:
    format: 'md'
---

Makes a new station playlist from a source and answers with what it did

**`POST`** `/station-playlists/import`

:::note
SDK method: `importPlaylist`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [PlaylistImportInput](../models/playlists/playlist-import-input.md) object.

## Response

`200 OK` — Returns a [PlaylistImportResult](../models/playlists/playlist-import-result.md) object.
