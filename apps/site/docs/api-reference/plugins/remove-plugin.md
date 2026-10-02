---
title: 'Remove plugin'
sidebar_label: 'Remove plugin'
sidebar_position: 7
mdx:
    format: 'md'
---

Removes a plugin the operator installed: stops it and deletes its folder. Its settings are kept, so importing it again brings them back. A bundled plugin is refused, unless an installed copy of it is left over from before the station shipped it: that copy never loads, and it is what gets removed

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
