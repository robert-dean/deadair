---
title: 'Export persona'
sidebar_label: 'Export persona'
sidebar_position: 10
mdx:
    format: 'md'
---

One character, its sheet and its stories, as a file

**`GET`** `/personas/{id}/export`

:::note
SDK method: `exportPersona`
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

`200 OK` — Returns a [PersonaFile](../models/personas/persona-file.md) object.

Response headers:

| Header                | Type     | Description |
| --------------------- | -------- | ----------- |
| `Content-Disposition` | `string` |             |

`404 Not Found`
