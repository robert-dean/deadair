---
title: 'Export break kind'
sidebar_label: 'Export break kind'
sidebar_position: 6
mdx:
    format: 'md'
---

One kind of break, as a file

**`GET`** `/breaks/kinds/{id}/export`

:::note
SDK method: `exportBreakKind`
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

`200 OK` — Returns a [BreakKindFile](../models/director/break-kind-file.md) object.

Response headers:

| Header                | Type     | Description |
| --------------------- | -------- | ----------- |
| `Content-Disposition` | `string` |             |

`404 Not Found`
