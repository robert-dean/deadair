---
title: 'Preview speech'
sidebar_label: 'Preview speech'
sidebar_position: 11
mdx:
    format: 'md'
---

Speaks the caller's words in one voice, so a break can be heard before it is written for air

**`POST`** `/voices/preview`

:::note
SDK method: `previewSpeech`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [SpeechPreviewRequest](../models/render/speech-preview-request.md) object.

## Response

`200 OK` `audio/mpeg` — Returns `Blob`.

`200` `audio/wav` — Returns `Blob`.

`200` `audio/ogg` — Returns `Blob`.

`200` `audio/flac` — Returns `Blob`.

`200` `audio/mp4` — Returns `Blob`.
