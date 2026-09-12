---
title: 'PluginImportResult'
sidebar_position: 12
mdx:
    format: 'md'
---

> What an import did

<details>
<summary>Attributes (3)</summary>

| Attribute         | Type              | Required | Description                                                                                                                               |
| ----------------- | ----------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `pluginId`        | `string`          | Yes      | The id the imported plugin claimed                                                                                                        |
| `restartRequired` | `boolean`         | Yes      | The same version was already loaded, so the station runs the build it had until it restarts. False for a new plugin and for a new version |
| `plugins`         | `PluginSummary[]` | Yes      | Every plugin, as the catalogue now stands. An import can take an older version away as well as add one                                    |

</details>
