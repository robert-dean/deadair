---
title: 'List track lyrics sources'
sidebar_label: 'List track lyrics sources'
sidebar_position: 18
mdx:
    format: 'md'
---

What every lyrics source answered for one record, in the order the station believes them

**`GET`** `/catalog/tracks/{id}/lyrics/sources`

:::note
SDK method: `listTrackLyricsSources`
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

`200 OK` — Returns a [TrackLyricsSources](../models/catalog/track-lyrics-sources.md) object.
