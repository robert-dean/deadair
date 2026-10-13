---
title: 'UserSignIn'
sidebar_position: 5
mdx:
    format: 'md'
---

> One time a person signed in

<details>
<summary>Attributes (5)</summary>

| Attribute      | Type      | Required | Description                        |
| -------------- | --------- | -------- | ---------------------------------- |
| `occurredAt`   | `string`  | Yes      | When                               |
| `method`       | `string`  | Yes      | The factor they signed in with     |
| `mfaSatisfied` | `boolean` | Yes      | Whether a second factor was proved |
| `ip`           | `string`  | No       | The address the request came from  |
| `userAgent`    | `string`  | No       | The app or browser that asked      |

</details>
