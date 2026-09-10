---
title: 'PhoneFactorRegistration'
sidebar_position: 59
mdx:
    format: 'md'
---

<details>
<summary>Attributes (3)</summary>

| Attribute       | Type      | Required | Description                                                                                                               |
| --------------- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `method`        | `'phone'` | Yes      | The method of the factor                                                                                                  |
| `value`         | `string`  | Yes      | The phone number in E.164 format (e.g. `+12025550123`)                                                                    |
| `codeChallenge` | `string`  | Yes      | A base64url encoded SHA256 hash of a one time secret used to validate that the request starts and ends on the same device |

</details>
