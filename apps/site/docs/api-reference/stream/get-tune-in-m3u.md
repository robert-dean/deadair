---
title: 'Get tune-in m3u'
sidebar_label: 'Get tune-in m3u'
sidebar_position: 3
mdx:
    format: 'md'
---

The station's streams as an M3U playlist, MP3 first, for a player that takes a playlist file rather than a stream address

**`GET`** `/listen.m3u`

:::note
SDK method: `getTuneInM3u`
Security: public
:::

## Response

`200 OK` — Returns `string`.

`404 Not Found`
