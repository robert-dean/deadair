---
title: 'Remove plugin'
sidebar_label: 'Remove plugin'
sidebar_position: 6
mdx:
    format: 'md'
---

Removes a plugin the operator installed: stops it and deletes its folder. Its settings are kept, so importing it again brings them back. A bundled plugin is refused

**`DELETE`** `/plugins/{id}`

:::note
SDK method: `removePlugin`
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

`200 OK` — Returns a list of [PluginSummary](../models/plugins/plugin-summary.md) objects.

`404 Not Found`

`409 Conflict`
