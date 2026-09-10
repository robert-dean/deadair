---
title: 'Clear track audio'
sidebar_label: 'Clear track audio'
sidebar_position: 12
mdx:
    format: 'md'
---

Drop the station's own copies of this record. The next play fetches them again

**`DELETE`** `/catalog/tracks/{id}/audio`

:::note
SDK method: `clearTrackAudio`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [TrackClearResult](../models/catalog/track-clear-result.md) object.

`409 Conflict`
