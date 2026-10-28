---
title: 'Sample pronunciation'
sidebar_label: 'Sample pronunciation'
sidebar_position: 18
mdx:
    format: 'md'
---

Speaks the written word as this entry says it, in one voice

**`POST`** `/pronunciations/sample`

:::note
SDK method: `samplePronunciation`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [PronunciationSampleRequest](../models/render/pronunciation-sample-request.md) object.

## Response

`200 OK` `audio/mpeg` — Returns `Blob`.

`200` `audio/wav` — Returns `Blob`.

`200` `audio/ogg` — Returns `Blob`.

`200` `audio/flac` — Returns `Blob`.

`200` `audio/mp4` — Returns `Blob`.
