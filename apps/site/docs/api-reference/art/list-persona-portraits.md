---
title: 'List persona portraits'
sidebar_label: 'List persona portraits'
sidebar_position: 8
mdx:
    format: 'md'
---

Every persona that has a portrait

**`GET`** `/art/personas`

:::note
SDK method: `listPersonaPortraits`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [PersonaPortraitList](../models/art/persona-portrait-list.md) object.
