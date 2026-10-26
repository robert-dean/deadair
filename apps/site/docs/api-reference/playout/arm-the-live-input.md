---
title: 'Arm the live input'
sidebar_label: 'Arm the live input'
sidebar_position: 9
mdx:
    format: 'md'
---

Arms the live input. From here, real signal from an encoder connected to it starts a short countdown, and then the presenter is on the air above the station's own programme. Arming an input that is already armed or on the air only replaces the title

**`POST`** `/playout/live/arm`

:::note
SDK method: `armTheLiveInput`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [PlayoutLiveArmInput](../models/playout/playout-live-arm-input.md) object.

## Response

`200 OK` — Returns a [PlayoutStatus](../models/playout/playout-status.md) object.

`409 Conflict`
