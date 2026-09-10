---
title: 'Read traces'
sidebar_label: 'Read traces'
sidebar_position: 6
mdx:
    format: 'md'
---

Recent decisions, newest first, folded to one row each

**`GET`** `/traces`

:::note
SDK method: `readTraces`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (3)</summary>

| Attribute    | Type      | Required | Description                                                               |
| ------------ | --------- | -------- | ------------------------------------------------------------------------- |
| `failedOnly` | `boolean` | No       | Only decisions carrying at least one failed call                          |
| `kind`       | `string`  | No       | An exact queue name or route, for reading one kind of decision on its own |
| `limit`      | `number`  | No       |                                                                           |

</details>

## Response

`200 OK` — Returns a [TracesPage](../models/station/traces-page.md) object.
