---
title: 'PluginDetail'
sidebar_position: 15
mdx:
    format: 'md'
---

> A summary plus the stored NON-SECRET configuration and the last recorded failure

Extends [`PluginSummary`](./plugin-summary.md)

<details>
<summary>Attributes (4)</summary>

| Attribute        | Type                      | Required | Description |
| ---------------- | ------------------------- | -------- | ----------- |
| `config`         | `Record<string, unknown>` | Yes      |             |
| `lastError`      | `string`                  | No       |             |
| `oauthConnected` | `boolean`                 | No       |             |
| `logLevel`       | `PluginLogLevel`          | Yes      |             |

</details>
