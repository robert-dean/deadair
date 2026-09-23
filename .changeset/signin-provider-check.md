---
'@deadair/web': minor
---

Saving the identity providers under Settings, Sign-in and security now checks them: the station asks each one for its sign-in details, the way the sign-in page will, and says under the list which answered. One that did not says why, such as "There is no server at auth.example.com." for a preset's placeholder left in place, or the status an issuer answered when its address is not quite right. A row the station cannot use at all, such as one still missing its client id, is listed too, since its button would otherwise just never appear. Check again asks once more.
