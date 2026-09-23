---
title: 'OAuthClientIssued'
sidebar_position: 13
mdx:
    format: 'md'
---

> A registered app, with its secret. The only time the secret is ever returned

<details>
<summary>Attributes (2)</summary>

| Attribute      | Type                 | Required | Description                                                                     |
| -------------- | -------------------- | -------- | ------------------------------------------------------------------------------- |
| `client`       | `OAuthClientSummary` | Yes      | The app as it will appear in the list                                           |
| `clientSecret` | `string`             | No       | Present for an app that keeps a secret. Store it now: nothing can show it again |

</details>
