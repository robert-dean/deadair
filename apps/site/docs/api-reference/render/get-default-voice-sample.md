---
title: 'Get default voice sample'
sidebar_label: 'Get default voice sample'
sidebar_position: 9
mdx:
    format: 'md'
---

A short line spoken in whichever voice the plugin falls back to

**`GET`** `/voices/sample`

:::note
SDK method: `getDefaultVoiceSample`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` `audio/mpeg` — Returns `Blob`.

`200` `audio/wav` — Returns `Blob`.

`200` `audio/ogg` — Returns `Blob`.

`200` `audio/flac` — Returns `Blob`.

`200` `audio/mp4` — Returns `Blob`.

Response headers:

| Header          | Type     | Description |
| --------------- | -------- | ----------- |
| `cache-control` | `string` |             |
| `etag`          | `string` |             |

`304`
