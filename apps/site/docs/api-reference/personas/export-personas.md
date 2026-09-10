---
title: 'Export personas'
sidebar_label: 'Export personas'
sidebar_position: 9
mdx:
    format: 'md'
---

Every character this station holds, as one file

**`GET`** `/personas/export`

:::note
SDK method: `exportPersonas`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [PersonaFile](../models/personas/persona-file.md) object.

Response headers:

| Header                | Type     | Description |
| --------------------- | -------- | ----------- |
| `Content-Disposition` | `string` |             |
