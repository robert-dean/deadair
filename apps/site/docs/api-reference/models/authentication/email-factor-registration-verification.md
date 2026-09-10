---
title: 'EmailFactorRegistrationVerification'
sidebar_position: 73
mdx:
    format: 'md'
---

<details>
<summary>Attributes (4)</summary>

| Attribute        | Type      | Required | Description                                                                                              |
| ---------------- | --------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `method`         | `'email'` | Yes      | The method of the factor                                                                                 |
| `registrationId` | `string`  | Yes      | The registration identifier                                                                              |
| `code`           | `string`  | Yes      | The verification code                                                                                    |
| `codeVerifier`   | `string`  | Yes      | A base64url encoded one time secret used to validate that the request starts and ends on the same device |

</details>
