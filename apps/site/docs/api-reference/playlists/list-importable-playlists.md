---
title: 'List importable playlists'
sidebar_label: 'List importable playlists'
sidebar_position: 1
mdx:
    format: 'md'
---

Fans out across every installed plugin that declares AND implements the `catalog` capability

**`GET`** `/playlists`

:::note
SDK method: `listImportablePlaylists`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [CatalogPlaylistPage](../models/playlists/catalog-playlist-page.md) object.
