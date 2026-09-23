---
title: 'OAuthAuthorizationContext'
sidebar_position: 3
mdx:
    format: 'md'
---

> A valid request, stashed for the signed-in person to approve or deny

<details>
<summary>Attributes (11)</summary>

| Attribute      | Type              | Required | Description                                                                                                 |
| -------------- | ----------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `kind`         | `'context'`       | Yes      | Discriminator                                                                                               |
| `requestId`    | `string`          | Yes      | What approving or denying names. Good for a few minutes, and only for the person it was shown to            |
| `clientId`     | `string`          | Yes      | The app's client id                                                                                         |
| `clientKind`   | `OAuthClientKind` | Yes      | How the station knows the app                                                                               |
| `clientName`   | `string`          | No       | What the app calls itself                                                                                   |
| `clientUri`    | `string`          | No       | The app's own website, when it gave one                                                                     |
| `logoUri`      | `string`          | No       | The app's logo, when it gave one                                                                            |
| `redirectHost` | `string`          | Yes      | The host the browser is sent back to, which is who actually receives the approval                           |
| `loopbackOnly` | `boolean`         | Yes      | Whether every address the app registered is this computer's own, which only an app running on it should use |
| `scope`        | `string[]`        | Yes      | What the app asked for. It acts as the person approving it whatever this says                               |
| `resource`     | `string`          | Yes      | What the app will be able to reach: the station's MCP endpoint                                              |

</details>
