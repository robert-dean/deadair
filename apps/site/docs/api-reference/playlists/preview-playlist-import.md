---
title: 'Preview playlist import'
sidebar_label: 'Preview playlist import'
sidebar_position: 13
mdx:
    format: 'md'
---

Reads a source and reports which of its records the library holds and which it would have to find. Writes nothing

**`POST`** `/station-playlists/import/preview`

:::note
SDK method: `previewPlaylistImport`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [PlaylistImportInput](../models/playlists/playlist-import-input.md) object.

## Response

`200 OK` — Returns a [PlaylistImportPlan](../models/playlists/playlist-import-plan.md) object.
