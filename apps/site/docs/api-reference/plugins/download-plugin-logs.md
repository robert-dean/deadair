---
title: 'Download plugin logs'
sidebar_label: 'Download plugin logs'
sidebar_position: 15
mdx:
    format: 'md'
---

Streams the plugin's full retained log as a plain-text attachment

**`GET`** `/plugins/{id}/logs/download`

:::note
SDK method: `downloadPluginLogs`
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
