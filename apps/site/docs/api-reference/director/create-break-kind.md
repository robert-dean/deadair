---
title: 'Create break kind'
sidebar_label: 'Create break kind'
sidebar_position: 2
mdx:
    format: 'md'
---

Writes a new kind of break. Nothing airs it until it is switched on and a band on the format clock names it

**`POST`** `/breaks/kinds`

:::note
SDK method: `createBreakKind`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [BreakKind](../models/director/break-kind.md) object.

## Response

`201 Created` — Returns a [BreakKindList](../models/director/break-kind-list.md) object.
