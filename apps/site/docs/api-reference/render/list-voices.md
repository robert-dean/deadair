---
title: 'List voices'
sidebar_label: 'List voices'
sidebar_position: 8
mdx:
    format: 'md'
---

The voices the station can be asked to speak in

**`GET`** `/voices`

:::note
SDK method: `listVoices`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [VoiceList](../models/render/voice-list.md) object.
