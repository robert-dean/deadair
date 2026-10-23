---
title: 'AsRunQuery'
sidebar_position: 6
mdx:
    format: 'md'
---

> One page of the as-run log, newest first

<details>
<summary>Attributes (3)</summary>

| Attribute | Type     | Required | Description                                                                                                 |
| --------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `limit`   | `number` | No       |                                                                                                             |
| `before`  | `string` | No       | Where the previous page ended. Opaque: pass back whatever `nextBefore` said                                 |
| `until`   | `string` | No       | Start reading from this moment back, to jump to an hour without paging to it. Ignored when `before` is sent |

</details>
