---
title: 'Generate persona'
sidebar_label: 'Generate persona'
sidebar_position: 7
mdx:
    format: 'md'
---

Turns a description of a character into a whole persona, checked against its own sample lines and handed back unsaved

**`POST`** `/personas/generate`

:::note
SDK method: `generatePersona`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [PersonaRequest](../models/personas/persona-request.md) object.

## Response

`200 OK` — Returns a [GeneratedPersona](../models/personas/generated-persona.md) object.
