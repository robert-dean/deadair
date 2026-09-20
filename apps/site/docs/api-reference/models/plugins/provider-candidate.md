---
title: 'ProviderCandidate'
sidebar_position: 12
mdx:
    format: 'md'
---

> One plugin's standing for one capability, as the Providers section draws it

<details>
<summary>Attributes (8)</summary>

| Attribute          | Type           | Required | Description                                                                                                                                          |
| ------------------ | -------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pluginId`         | `string`       | Yes      |                                                                                                                                                      |
| `name`             | `string`       | Yes      | The plugin's own name, which is what an operator knows it by. The id is what is stored                                                               |
| `enabled`          | `boolean`      | Yes      |                                                                                                                                                      |
| `status`           | `PluginStatus` | Yes      |                                                                                                                                                      |
| `position`         | `number`       | No       | Where in the asking order this plugin sits, counting from 1. Absent when it cannot currently answer, which is every status but `active`              |
| `listed`           | `boolean`      | Yes      | Whether the operator named this plugin, as opposed to it being here because it is installed. False everywhere when nothing is set                    |
| `inUse`            | `boolean`      | Yes      | Whether the station reaches this plugin for this capability. Every active candidate for an `ordered` capability, and only the chosen one for a `one` |
| `declaredPriority` | `number`       | No       | `enrichment` only: the number the plugin's AUTHOR gave it, which orders whatever the operator did not. Lower wins a conflicting fact                 |

</details>
