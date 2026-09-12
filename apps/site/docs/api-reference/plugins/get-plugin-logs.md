---
title: 'Get plugin logs'
sidebar_label: 'Get plugin logs'
sidebar_position: 14
mdx:
    format: 'md'
---

Returns the plugin's buffered log lines at or above the current log level

**`GET`** `/plugins/{id}/logs`

:::note
SDK method: `getPluginLogs`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (3)</summary>

| Attribute | Type             | Required | Description     |
| --------- | ---------------- | -------- | --------------- |
| `id`      | `string`         | Yes      | Path parameter. |
| `level`   | `PluginLogLevel` | No       |                 |
| `limit`   | `number`         | No       |                 |

</details>

## Response

`200 OK` — Returns a [PluginLogPage](../models/plugins/plugin-log-page.md) object.
