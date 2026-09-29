---
title: 'List importable playlists'
sidebar_label: 'List importable playlists'
sidebar_position: 1
mdx:
    format: 'md'
---

Every playlist the installed `catalog` plugins offer, as the library sync last read each one's list. A source with no list kept yet is asked while the request waits

**`GET`** `/playlists`

:::note
SDK method: `listImportablePlaylists`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [CatalogPlaylistPage](../models/playlists/catalog-playlist-page.md) object.
