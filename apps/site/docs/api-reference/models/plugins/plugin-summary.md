---
title: 'PluginSummary'
sidebar_position: 9
mdx:
    format: 'md'
---

> A plugin as the settings list sees it. Carries no configured VALUES, only which secrets are set

<details>
<summary>Attributes (13)</summary>

| Attribute           | Type                      | Required | Description                                                                                                                                        |
| ------------------- | ------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | `string`                  | Yes      |                                                                                                                                                    |
| `name`              | `string`                  | Yes      |                                                                                                                                                    |
| `version`           | `string`                  | Yes      |                                                                                                                                                    |
| `capabilities`      | `string[]`                | Yes      |                                                                                                                                                    |
| `status`            | `PluginStatus`            | Yes      |                                                                                                                                                    |
| `enabled`           | `boolean`                 | Yes      |                                                                                                                                                    |
| `description`       | `string`                  | No       |                                                                                                                                                    |
| `icon`              | `string`                  | No       |                                                                                                                                                    |
| `configFields`      | `ConfigFieldDescriptor[]` | Yes      |                                                                                                                                                    |
| `secretsConfigured` | `Record<string, boolean>` | Yes      | Whether a value is currently stored, per `secret` field under its own key and per `secret` cell under `field/rowId/column`. Never the value itself |
| `firstEnabledAt`    | `string`                  | No       | When this plugin was first ever enabled. Absent means it never has been, so the console asks before it is. _read-only_                             |
| `lastError`         | `string`                  | No       | The last recorded failure. Absent means it is not currently unhappy                                                                                |
| `nextProbeAt`       | `string`                  | No       | When the breaker will probe this plugin again on its own. Absent means no probe is pending. _read-only_                                            |

</details>
