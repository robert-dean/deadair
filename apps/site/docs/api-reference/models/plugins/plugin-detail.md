---
title: 'PluginDetail'
sidebar_position: 15
mdx:
    format: 'md'
---

> A summary plus the stored NON-SECRET configuration

Extends [`PluginSummary`](./plugin-summary.md)

<details>
<summary>Attributes (3)</summary>

| Attribute        | Type                      | Required | Description |
| ---------------- | ------------------------- | -------- | ----------- |
| `config`         | `Record<string, unknown>` | Yes      |             |
| `oauthConnected` | `boolean`                 | No       |             |
| `logLevel`       | `PluginLogLevel`          | Yes      |             |

</details>
