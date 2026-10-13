---
title: 'Invitation'
sidebar_position: 2
mdx:
    format: 'md'
---

> An invitation for somebody to take an account on the station

<details>
<summary>Attributes (10)</summary>

| Attribute    | Type              | Required | Description                                                                                                                                                                                             |
| ------------ | ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | `string`          | Yes      | The invitation's id                                                                                                                                                                                     |
| `email`      | `string`          | Yes      | The address the account will have. The person cannot change it while accepting                                                                                                                          |
| `role`       | `PlatformRole`    | Yes      | The role the account will hold                                                                                                                                                                          |
| `state`      | `InvitationState` | Yes      | Where it stands                                                                                                                                                                                         |
| `createdAt`  | `string`          | Yes      | When it was made                                                                                                                                                                                        |
| `expiresAt`  | `string`          | Yes      | When the link stops working, if nobody has used it                                                                                                                                                      |
| `invitedBy`  | `string`          | No       | The address of the admin who made it. Absent once their account is gone                                                                                                                                 |
| `acceptedAt` | `string`          | No       | When somebody accepted it                                                                                                                                                                               |
| `revokedAt`  | `string`          | No       | When it was withdrawn, by an admin or by a newer invitation to the same address                                                                                                                         |
| `token`      | `string`          | No       | The invitation itself, only while it is pending. Put it after `#` on the station's `/invite` page, as `/invite#<token>`. Anyone holding it can claim the account, so show it only to the person invited |

</details>
