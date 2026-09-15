---
'@deadair/api': minor
'@deadair/web': minor
'@deadair/sdk': minor
---

Any playlist can now be hidden from its card on the Playlists page: open the **⋯** menu on the card and choose **Hide**. A hidden playlist moves into **Show N hidden** at the bottom of the page, is no longer offered in the schedule, sustaining and programme pickers or in persona auditions, and the library sync stops reading it, so records that only it held leave the library the way they would if the playlist were deleted. Choose **Show again** on its card to undo it; nothing is deleted. A schedule block or setting that already plays from a playlist you then hide keeps playing from it. The pickers also stop offering playlists their source refuses to share, since those could only fail at air time. Hiding needs an admin. New table `hidden_playlists` (migration 0030); `CatalogPlaylist` gains an optional `hidden`; new `PUT` and `DELETE /playlists/{pluginId}/{playlistId}/hidden`.
