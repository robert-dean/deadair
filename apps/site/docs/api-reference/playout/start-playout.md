---
title: 'Start playout'
sidebar_label: 'Start playout'
sidebar_position: 5
mdx:
    format: 'md'
---

Puts the station back on air with the running order it already has, picking it up where Stop left it. Distinct from putting a playlist on air, which builds a new broadcast and throws away what was there. Refused when there is nothing left to resume

**`POST`** `/playout/start`

:::note
SDK method: `startPlayout`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [PlayoutStatus](../models/playout/playout-status.md) object.
