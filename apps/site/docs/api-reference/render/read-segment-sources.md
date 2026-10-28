---
title: 'Read segment sources'
sidebar_label: 'Read segment sources'
sidebar_position: 13
mdx:
    format: 'md'
---

The stored facts a written break was handed, the ones it said first

**`GET`** `/segments/{id}/sources`

:::note
SDK method: `readSegmentSources`
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

`200 OK` — Returns a [SegmentSourceList](../models/render/segment-source-list.md) object.
