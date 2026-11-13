---
title: 'Look up a festival'
sidebar_label: 'Look up a festival'
sidebar_position: 3
mdx:
    format: 'md'
---

Looks festivals up by name with the concert plugins that can list them, for an operator about to add one. Nothing is saved

**`GET`** `/festivals/lookup`

:::note
SDK method: `lookUpAFestival`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description |
| --------- | -------- | -------- | ----------- |
| `name`    | `string` | Yes      |             |

</details>

## Response

`200 OK` — Returns a [FestivalLookup](../models/schedule/festival-lookup.md) object.
