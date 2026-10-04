---
title: 'Get vocal markers'
sidebar_label: 'Get vocal markers'
sidebar_position: 14
mdx:
    format: 'md'
---

Where the singing starts and stops on one record, from an operator's correction or its timed lyrics

**`GET`** `/catalog/tracks/{id}/vocal-markers`

:::note
SDK method: `getVocalMarkers`
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

`200 OK` — Returns a [VocalMarkersDetail](../models/catalog/vocal-markers-detail.md) object.
