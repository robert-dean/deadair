---
title: 'LogLine'
sidebar_position: 4
mdx:
    format: 'md'
---

> One line, as far as it could be read back

<details>
<summary>Attributes (3)</summary>

| Attribute | Type       | Required | Description                                                                                           |
| --------- | ---------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `ts`      | `string`   | No       | Absent on a line this API did not write, and on one of its own that did not parse                     |
| `level`   | `LogLevel` | No       | Absent for the same two reasons                                                                       |
| `text`    | `string`   | Yes      | Must match MAX_LINE_BYTES_CEILING in apps/api/src/logging/rotating.log.store.ts. Change both together |

</details>
