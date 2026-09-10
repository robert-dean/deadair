---
title: 'TracesQuery'
sidebar_position: 16
mdx:
    format: 'md'
---

> Which slice of the kept window to read

<details>
<summary>Attributes (3)</summary>

| Attribute    | Type      | Required | Description                                                               |
| ------------ | --------- | -------- | ------------------------------------------------------------------------- |
| `limit`      | `number`  | No       |                                                                           |
| `kind`       | `string`  | No       | An exact queue name or route, for reading one kind of decision on its own |
| `failedOnly` | `boolean` | No       | Only decisions carrying at least one failed call                          |

</details>
