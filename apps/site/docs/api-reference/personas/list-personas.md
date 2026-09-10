---
title: 'List personas'
sidebar_label: 'List personas'
sidebar_position: 5
mdx:
    format: 'md'
---

Every persona this station has, oldest first

**`GET`** `/personas`

:::note
SDK method: `listPersonas`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [PersonaList](../models/personas/persona-list.md) object.
