---
title: 'FetcherAuthorization'
sidebar_position: 1
mdx:
    format: 'md'
---

> What the station's track fetcher holds by way of a Spotify login

<details>
<summary>Attributes (7)</summary>

| Attribute     | Type      | Required | Description                                                                                                                                                                                                                                                           |
| ------------- | --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reachable`   | `boolean` | Yes      | Whether the fetcher answered at all. False makes every field below a default rather than a reading, so a fetcher that is merely down is never reported as one that was never authorized                                                                               |
| `configured`  | `boolean` | Yes      | Whether this install has a stream half yet. False means there is nothing here to authorize                                                                                                                                                                            |
| `authorized`  | `boolean` | Yes      | Whether the fetcher holds its OWN stored authorization, which is the only kind Spotify's login accepts. False with a healthy plugin above it is a station that lists playlists perfectly and cannot fetch a single record                                             |
| `session`     | `boolean` | Yes      | Whether a login is established right now                                                                                                                                                                                                                              |
| `loginError`  | `string`  | No       | The last reason a login was refused. Present is not the same as fatal: a session may have recovered since                                                                                                                                                             |
| `pendingUrl`  | `string`  | No       | An authorization already started and not yet finished, so an operator who lost the URL is given it back rather than having to start again                                                                                                                             |
| `callbackUrl` | `string`  | No       | The address the browser will be sent to and will not be able to load. Reported so the console can say which page is expected to fail, rather than leaving that looking like a fault. Absent when the fetcher did not answer, since it is the only thing that knows it |

</details>
