---
title: 'Get stored audio'
sidebar_label: 'Get stored audio'
sidebar_position: 14
mdx:
    format: 'md'
---

Audio out of the segment store, addressed by content rather than by row

**`GET`** `/audio/{checksum}/{ext}`

:::note
SDK method: `getStoredAudio`
Security: public
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute  | Type     | Required | Description     |
| ---------- | -------- | -------- | --------------- |
| `checksum` | `string` | Yes      | Path parameter. |
| `ext`      | `string` | Yes      | Path parameter. |

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
