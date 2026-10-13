---
title: 'InvitationAcceptWithAuthenticator'
sidebar_position: 12
mdx:
    format: 'md'
---

> Accept with the first code from the authenticator app

<details>
<summary>Attributes (5)</summary>

| Attribute        | Type              | Required | Description                       |
| ---------------- | ----------------- | -------- | --------------------------------- |
| `method`         | `'authenticator'` | Yes      | Discriminator                     |
| `token`          | `string`          | Yes      | The invitation's token            |
| `password`       | `string`          | Yes      | The same password as at the start |
| `registrationId` | `string`          | Yes      | From the start                    |
| `code`           | `string`          | Yes      | The first code the app shows      |

</details>
