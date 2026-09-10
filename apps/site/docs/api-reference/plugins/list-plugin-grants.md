---
title: 'List plugin grants'
sidebar_label: 'List plugin grants'
sidebar_position: 2
mdx:
    format: 'md'
---

Every capability an installed plugin is asking the operator for, with the answer so far

**`GET`** `/plugins/grants`

:::note
SDK method: `listPluginGrants`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [PluginGrantList](../models/plugins/plugin-grant-list.md) object.
