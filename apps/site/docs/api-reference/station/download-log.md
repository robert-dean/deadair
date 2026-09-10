---
title: 'Download log'
sidebar_label: 'Download log'
sidebar_position: 3
mdx:
    format: 'md'
---

The retained log as a plain-text attachment, oldest first, as the file is written

**`GET`** `/logs/{id}/download`

:::note
SDK method: `downloadLog`
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

`200 OK` — Returns `string`.

Response headers:

| Header                | Type     | Description |
| --------------------- | -------- | ----------- |
| `Content-Disposition` | `string` |             |

`404 Not Found`
