---
title: 'SigninProviderCheck'
sidebar_position: 5
mdx:
    format: 'md'
---

> One identity provider row, and whether its issuer answered as one

<details>
<summary>Attributes (5)</summary>

| Attribute | Type      | Required | Description                                                         |
| --------- | --------- | -------- | ------------------------------------------------------------------- |
| `name`    | `string`  | Yes      | The row's name                                                      |
| `label`   | `string`  | Yes      | What its button says                                                |
| `issuer`  | `string`  | Yes      | The issuer that was asked                                           |
| `ok`      | `boolean` | Yes      | Whether the issuer answered with a discovery document naming itself |
| `problem` | `string`  | No       | Why not, in a sentence. Absent when it answered                     |

</details>
