---
title: 'PluginDetail'
sidebar_position: 18
mdx:
    format: 'md'
---

> A summary plus the stored NON-SECRET configuration

Extends [`PluginSummary`](./plugin-summary.md)

<details>
<summary>Attributes (4)</summary>

| Attribute        | Type                      | Required | Description                                            |
| ---------------- | ------------------------- | -------- | ------------------------------------------------------ |
| `dir`            | `string`                  | Yes      | Absolute path of the plugin's directory on the station |
| `config`         | `Record<string, unknown>` | Yes      |                                                        |
| `oauthConnected` | `boolean`                 | No       |                                                        |
| `logLevel`       | `PluginLogLevel`          | Yes      |                                                        |

</details>
