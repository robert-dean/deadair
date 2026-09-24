---
title: 'OAuthAuthorizationApproval'
sidebar_position: 9
mdx:
    format: 'md'
---

> Approving a stashed request, with what the app may do

<details>
<summary>Attributes (2)</summary>

| Attribute   | Type                | Required | Description                                                                                                  |
| ----------- | ------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `requestId` | `string`            | Yes      | From the context                                                                                             |
| `scopes`    | `OAuthGrantScope[]` | Yes      | What the person lets the app do. At least one; `manage` includes `view`. Replaces whatever the app asked for |

</details>
