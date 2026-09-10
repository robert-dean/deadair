---
title: 'Clear track analysis'
sidebar_label: 'Clear track analysis'
sidebar_position: 13
mdx:
    format: 'md'
---

Forget the measurement, so the walk takes it again

**`DELETE`** `/catalog/tracks/{id}/analysis`

:::note
SDK method: `clearTrackAnalysis`
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
