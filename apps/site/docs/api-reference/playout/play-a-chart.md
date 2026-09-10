---
title: 'Play a chart'
sidebar_label: 'Play a chart'
sidebar_position: 3
mdx:
    format: 'md'
---

Builds the running order from a published chart and starts handing it to the player. The same replacement a playlist makes, from a document somebody else ranked

**`POST`** `/playout/chart`

:::note
SDK method: `playAChart`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [PlayoutChartInput](../models/playout/playout-chart-input.md) object.

## Response

`200 OK` — Returns a [PlayoutStatus](../models/playout/playout-status.md) object.
