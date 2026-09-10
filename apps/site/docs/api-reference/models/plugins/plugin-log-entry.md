---
title: 'PluginLogEntry'
sidebar_position: 11
mdx:
    format: 'md'
---

<details>
<summary>Attributes (3)</summary>

| Attribute | Type             | Required | Description                                                                                           |
| --------- | ---------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `ts`      | `string`         | Yes      |                                                                                                       |
| `level`   | `PluginLogLevel` | Yes      |                                                                                                       |
| `text`    | `string`         | Yes      | Must match MAX_LINE_BYTES_CEILING in apps/api/src/logging/rotating.log.store.ts. Change both together |

</details>
