---
title: 'InvitationAcceptWithPasskey'
sidebar_position: 13
mdx:
    format: 'md'
---

> Accept with the passkey the browser just made

<details>
<summary>Attributes (5)</summary>

| Attribute        | Type                                 | Required | Description                                  |
| ---------------- | ------------------------------------ | -------- | -------------------------------------------- |
| `method`         | `'fido'`                             | Yes      | Discriminator                                |
| `token`          | `string`                             | Yes      | The invitation's token                       |
| `password`       | `string`                             | Yes      | The same password as at the start            |
| `registrationId` | `string`                             | Yes      | From the start                               |
| `credential`     | `PublicKeyCredentialWithAttestation` | Yes      | What `navigator.credentials.create` answered |

</details>
