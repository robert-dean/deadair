---
title: 'Export break kinds'
sidebar_label: 'Export break kinds'
sidebar_position: 5
mdx:
    format: 'md'
---

Every kind of break you have written, as one file

**`GET`** `/breaks/kinds/export`

:::note
SDK method: `exportBreakKinds`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [BreakKindFile](../models/director/break-kind-file.md) object.

Response headers:

| Header                | Type     | Description |
| --------------------- | -------- | ----------- |
| `Content-Disposition` | `string` |             |
