---
title: 'Get track lyrics'
sidebar_label: 'Get track lyrics'
sidebar_position: 17
mdx:
    format: 'md'
---

The words of one record, from the lyrics source the station believes, with the timing of each line when that source has it

**`GET`** `/catalog/tracks/{id}/lyrics`

:::note
SDK method: `getTrackLyrics`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [TrackLyrics](../models/catalog/track-lyrics.md) object.
