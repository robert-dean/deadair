---
title: 'Add a never-play rule'
sidebar_label: 'Add a never-play rule'
sidebar_position: 21
mdx:
    format: 'md'
---

Adds a rule. It holds from the next record the station chooses

**`POST`** `/rules`

:::note
SDK method: `addANeverPlayRule`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [BlockRule](../models/director/block-rule.md) object.

## Response

`200 OK` — Returns a [BlockRuleList](../models/director/block-rule-list.md) object.
