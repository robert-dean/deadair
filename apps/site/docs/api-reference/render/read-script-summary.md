---
title: 'Read script summary'
sidebar_label: 'Read script summary'
sidebar_position: 7
mdx:
    format: 'md'
---

Write attempts by outcome, per presenter, over a recent window

**`GET`** `/scripts/summary`

:::note
SDK method: `readScriptSummary`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description                                                                                                                                                                                                 |
| --------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hours`   | `number` | No       | How far back to count. Defaults to 24, and a week at most, because past that the nightly sweep may already have taken the rows and the count would quietly be of what survived rather than of what happened |

</details>

## Response

`200 OK` — Returns a [ScriptHistorySummary](../models/render/script-history-summary.md) object.
