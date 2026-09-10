---
title: 'Create persona'
sidebar_label: 'Create persona'
sidebar_position: 6
mdx:
    format: 'md'
---

Writes a new persona. It is not put on air by creating it

**`POST`** `/personas`

:::note
SDK method: `createPersona`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [Persona](../models/personas/persona.md) object.

## Response

`201 Created` — Returns a [PersonaList](../models/personas/persona-list.md) object.
