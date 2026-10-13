---
title: 'UserFactor'
sidebar_position: 4
mdx:
    format: 'md'
---

> One way a person signs in. Never the secret itself

<details>
<summary>Attributes (4)</summary>

| Attribute  | Type                                                                      | Required | Description                                                           |
| ---------- | ------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| `method`   | `'email' \| 'password' \| 'authenticator' \| 'fido' \| 'oidc' \| 'phone'` | Yes      | What kind of factor it is                                             |
| `methodId` | `string`                                                                  | Yes      | Which factor of that kind                                             |
| `kind`     | `'knowledge' \| 'possession' \| 'biometric'`                              | Yes      | What it proves                                                        |
| `label`    | `string`                                                                  | No       | How it is shown, such as a masked address or the authenticator's name |

</details>
