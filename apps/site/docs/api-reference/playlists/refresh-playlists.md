---
title: 'Refresh playlists'
sidebar_label: 'Refresh playlists'
sidebar_position: 5
mdx:
    format: 'md'
---

Reads every playlist on every music source again, in the background, rather than waiting for the next scheduled read. New records reach the library; records gone from every playlist are retired

**`POST`** `/playlists/refresh`

:::note
SDK method: `refreshPlaylists`
Security: authenticated (policy: platform.manage)
:::
