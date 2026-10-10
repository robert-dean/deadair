---
title: 'Get now playing lyrics'
sidebar_label: 'Get now playing lyrics'
sidebar_position: 2
mdx:
    format: 'md'
---

The words of the record on air, with what a player needs to follow along line by line

**`GET`** `/nowplaying/lyrics`

:::note
SDK method: `getNowPlayingLyrics`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [NowPlayingLyrics](../models/nowplaying/now-playing-lyrics.md) object.
