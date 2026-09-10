---
title: 'Get now playing'
sidebar_label: 'Get now playing'
sidebar_position: 1
mdx:
    format: 'md'
---

What is on air right now. Answers 200 with `onAir: false` when the station is quiet, so a device polling this treats silence as an answer rather than an error

**`GET`** `/nowplaying`

:::note
SDK method: `getNowPlaying`
Security: public
:::

## Response

`200 OK` — Returns a [NowPlaying](../models/nowplaying/now-playing.md) object.
