---
title: 'List never-play rules'
sidebar_label: 'List never-play rules'
sidebar_position: 20
mdx:
    format: 'md'
---

Every never-play rule on this station, newest first, each saying whether it holds right now

**`GET`** `/rules`

:::note
SDK method: `listNeverPlayRules`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [BlockRuleList](../models/director/block-rule-list.md) object.
