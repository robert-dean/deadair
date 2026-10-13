---
title: 'UserSummary'
sidebar_position: 2
mdx:
    format: 'md'
---

> A person with an account on the station

<details>
<summary>Attributes (7)</summary>

| Attribute         | Type           | Required | Description                                                                                                                    |
| ----------------- | -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `id`              | `string`       | Yes      | The person's account id                                                                                                        |
| `email`           | `string`       | No       | The address they sign in with. Absent for an account that has none, such as one made through a provider that shared no address |
| `role`            | `PlatformRole` | No       | The one role they hold. Absent for an account nobody has granted one                                                           |
| `active`          | `boolean`      | Yes      | False once the account has been switched off. A switched-off person cannot sign in, and every session they held has ended      |
| `createdAt`       | `string`       | Yes      | When the account was made                                                                                                      |
| `lastSignInAt`    | `string`       | No       | When they last signed in. Absent if they never have                                                                            |
| `hasStrongFactor` | `boolean`      | Yes      | Whether they have an authenticator app or a passkey, which the phone apps need to sign in with                                 |

</details>
