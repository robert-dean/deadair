---
title: 'Read chart'
sidebar_label: 'Read chart'
sidebar_position: 2
mdx:
    format: 'md'
---

One chart's records, ranked

**`GET`** `/charts/{id}`

:::note
SDK method: `readChart`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (3)</summary>

| Attribute | Type     | Required | Description                                                                                                                               |
| --------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `id`      | `string` | Yes      | Path parameter.                                                                                                                           |
| `date`    | `string` | No       | Which edition, as `YYYY-MM-DD`. Absent means the current one, and a service that keeps no history answers with the current one either way |
| `limit`   | `number` | No       |                                                                                                                                           |

</details>

## Response

`200 OK` — Returns a [ChartPage](../models/charts/chart-page.md) object.
