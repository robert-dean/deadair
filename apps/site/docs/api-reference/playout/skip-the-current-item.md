---
title: 'Skip the current item'
sidebar_label: 'Skip the current item'
sidebar_position: 4
mdx:
    format: 'md'
---

Ends the item on air so the next one starts immediately. The station owns the decoder, so this lands at once rather than waiting out audio already committed to a player

**`POST`** `/playout/skip`

:::note
SDK method: `skipTheCurrentItem`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [PlayoutStatus](../models/playout/playout-status.md) object.
