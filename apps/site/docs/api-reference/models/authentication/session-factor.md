---
title: 'SessionFactor'
sidebar_position: 58
mdx:
    format: 'md'
---

> A factor satisfied by the session

<details>
<summary>Attributes (5)</summary>

| Attribute         | Type                                                                      | Required | Description                                                        |
| ----------------- | ------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| `method`          | `'phone' \| 'password' \| 'authenticator' \| 'email' \| 'fido' \| 'oidc'` | Yes      | The verification method                                            |
| `methodId`        | `string`                                                                  | Yes      | Stable identifier for the specific factor record                   |
| `kind`            | `'knowledge' \| 'possession' \| 'biometric'`                              | Yes      | MFA category for the factor                                        |
| `issuedAt`        | `string`                                                                  | Yes      | When this factor entry was first added to the session. _read-only_ |
| `authenticatedAt` | `string`                                                                  | Yes      | When the factor was most recently re-verified. _read-only_         |

</details>
