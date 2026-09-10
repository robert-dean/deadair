---
title: 'AuthenticatorFactorRegistration'
sidebar_position: 62
mdx:
    format: 'md'
---

<details>
<summary>Attributes (3)</summary>

| Attribute       | Type              | Required | Description                                                                                                               |
| --------------- | ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `method`        | `'authenticator'` | Yes      | The method of the factor                                                                                                  |
| `codeChallenge` | `string`          | Yes      | A base64url encoded SHA256 hash of a one time secret used to validate that the request starts and ends on the same device |
| `label`         | `string`          | No       | The label for the authenticator factor                                                                                    |

</details>
