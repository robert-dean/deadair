---
title: 'Get segment audio'
sidebar_label: 'Get segment audio'
sidebar_position: 13
mdx:
    format: 'md'
---

The audio of one segment

**`GET`** `/segments/{id}/audio`

:::note
SDK method: `getSegmentAudio`
Security: public
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute   | Type                    | Required | Description                                                                                                                          |
| ----------- | ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `id`        | `string`                | Yes      | Path parameter.                                                                                                                      |
| `rendition` | `SegmentAudioRendition` | Yes      | A purpose the station interprets rather than a format the caller picks, so what `share` means can change without any caller changing |

</details>

## Response

`200 OK` `audio/mpeg` — Returns `Blob`.

`200` `audio/wav` — Returns `Blob`.

`200` `audio/ogg` — Returns `Blob`.

`200` `audio/flac` — Returns `Blob`.

`200` `audio/mp4` — Returns `Blob`.

Response headers:

| Header                | Type     | Description                                       |
| --------------------- | -------- | ------------------------------------------------- |
| `cache-control`       | `string` |                                                   |
| `etag`                | `string` |                                                   |
| `content-disposition` | `string` | A file name to save it under, on the `share` copy |

`304`

`503`
