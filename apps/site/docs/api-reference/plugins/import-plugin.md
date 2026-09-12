---
title: 'Import plugin'
sidebar_label: 'Import plugin'
sidebar_position: 4
mdx:
    format: 'md'
---

Takes a plugin in from the browser as the tarball npm pack writes and puts it in the plugins directory. It lands disabled, and a newer version of an installed plugin replaces the older one

**`POST`** `/plugins/import`

:::note
SDK method: `importPlugin`
Security: authenticated (policy: platform.manage)
:::

## Request body (`multipart/form-data`)

Accepts a [PluginImport](../models/plugins/plugin-import.md) object.

## Response

`200 OK` — Returns a [PluginImportResult](../models/plugins/plugin-import-result.md) object.

`400 Bad Request`

`409 Conflict`

`413`

`415`

`422 Unprocessable Entity`
