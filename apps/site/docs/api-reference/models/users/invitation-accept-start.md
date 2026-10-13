---
title: 'InvitationAcceptStart'
sidebar_position: 8
mdx:
    format: 'md'
---

> Choose a password and a second step. Nothing is saved yet

<details>
<summary>Attributes (3)</summary>

| Attribute  | Type                   | Required | Description                                                                                                              |
| ---------- | ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `token`    | `string`               | Yes      | The invitation's token                                                                                                   |
| `password` | `string`               | Yes      | The password the account will have. Refused here if it is too weak, so the person learns before setting anything else up |
| `method`   | `InvitationSecondStep` | Yes      | The second step to set up                                                                                                |

</details>
