---
title: 'Retry track audio'
sidebar_label: 'Retry track audio'
sidebar_position: 14
mdx:
    format: 'md'
---

Try this record's copies again now, rather than when the backoff says

**`POST`** `/catalog/tracks/{id}/retry`

:::note
SDK method: `retryTrackAudio`
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
