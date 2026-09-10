---
title: 'Get voice sample'
sidebar_label: 'Get voice sample'
sidebar_position: 10
mdx:
    format: 'md'
---

A short line spoken in one voice, so an operator can hear it before choosing it

**`GET`** `/voices/{voiceId}/sample`

:::note
SDK method: `getVoiceSample`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `voiceId` | `string` | Yes      | Path parameter. |

</details>

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
