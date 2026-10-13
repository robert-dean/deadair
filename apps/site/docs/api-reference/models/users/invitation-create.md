---
title: 'InvitationCreate'
sidebar_position: 4
mdx:
    format: 'md'
---

> Invite somebody by their address

<details>
<summary>Attributes (3)</summary>

| Attribute | Type           | Required | Description                                                                                                  |
| --------- | -------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `email`   | `string`       | Yes      | The address the account will have                                                                            |
| `role`    | `PlatformRole` | Yes      | The role the account will hold                                                                               |
| `send`    | `boolean`      | No       | Email the link to the address too. Refused with a 503, and nothing made, when the station has no mail server |

</details>
