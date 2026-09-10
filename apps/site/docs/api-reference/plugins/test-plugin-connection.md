---
title: 'Test plugin connection'
sidebar_label: 'Test plugin connection'
sidebar_position: 10
mdx:
    format: 'md'
---

Runs the plugin's own `testConnection()` through the invoker

**`POST`** `/plugins/{id}/test`

:::note
SDK method: `testPluginConnection`
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

`200 OK` — Returns a [PluginTestResult](../models/plugins/plugin-test-result.md) object.
