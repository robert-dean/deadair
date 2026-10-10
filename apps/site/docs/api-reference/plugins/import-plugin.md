---
title: 'Import plugin'
sidebar_label: 'Import plugin'
sidebar_position: 5
mdx:
    format: 'md'
---

Takes a plugin in from the browser as the tarball npm pack writes and puts it in the plugins directory. Importing runs the plugin's code: the station loads it to read its manifest, inside the server and with the server's privileges. It lands disabled, which only means the station does not use it until it is enabled. A newer version of an installed plugin replaces the older one

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
