---
title: 'Suggest plugin config options'
sidebar_label: 'Suggest plugin config options'
sidebar_position: 13
mdx:
    format: 'md'
---

Asks the plugin what to offer for its config fields right now, through the invoker

**`POST`** `/plugins/{id}/config/suggestions`

:::note
SDK method: `suggestPluginConfigOptions`
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

`200 OK` — Returns a [PluginFieldSuggestions](../models/plugins/plugin-field-suggestions.md) object.
