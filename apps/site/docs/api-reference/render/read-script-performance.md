---
title: 'Read script performance'
sidebar_label: 'Read script performance'
sidebar_position: 8
mdx:
    format: 'md'
---

Outcomes, decline reasons and ratings, per presenter and kind of break

**`GET`** `/scripts/performance`

:::note
SDK method: `readScriptPerformance`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description                                                                                                                                    |
| --------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `days`    | `number` | No       | How far back to read. Defaults to 30. The nightly sweep decides how far back there is anything to read, and ratings go with the rows they rate |

</details>

## Response

`200 OK` — Returns a [ScriptPerformance](../models/render/script-performance.md) object.
