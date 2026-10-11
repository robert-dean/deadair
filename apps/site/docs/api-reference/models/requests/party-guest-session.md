---
title: 'PartyGuestSession'
sidebar_position: 14
mdx:
    format: 'md'
---

> A guest's way in: send it as a bearer token on the request routes

<details>
<summary>Attributes (2)</summary>

| Attribute     | Type     | Required | Description                                                                                                    |
| ------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `accessToken` | `string` | Yes      | The bearer token. It lets a guest search for records, ask for one and see their own requests, and nothing else |
| `expiresAt`   | `string` | Yes      | When it stops working, which is when the party's pass does                                                     |

</details>
