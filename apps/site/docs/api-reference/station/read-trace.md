---
title: 'Read trace'
sidebar_label: 'Read trace'
sidebar_position: 7
mdx:
    format: 'md'
---

One decision: every call it made, and the decisions on either side of it

**`GET`** `/traces/{id}`

:::note
SDK method: `readTrace`
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

`200 OK` — Returns a [TraceDetail](../models/station/trace-detail.md) object.

`404 Not Found`
