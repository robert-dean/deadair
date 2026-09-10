---
title: 'EmailFactorRegistration'
sidebar_position: 61
mdx:
    format: 'md'
---

<details>
<summary>Attributes (3)</summary>

| Attribute       | Type      | Required | Description                                                                                                               |
| --------------- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `method`        | `'email'` | Yes      | The method of the factor                                                                                                  |
| `value`         | `string`  | Yes      | The email address                                                                                                         |
| `codeChallenge` | `string`  | Yes      | A base64url encoded SHA256 hash of a one time secret used to validate that the request starts and ends on the same device |

</details>
