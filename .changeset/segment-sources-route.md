---
'@deadair/api': patch
'@deadair/sdk': patch
---

`GET /segments/{id}/sources` answers where a break's facts came from: each stored fact its writer was handed, with the page, the quoted span that states it, the plugin that fetched it, and whether the break's words said it. The ones it said come first. A break handed no stored fact answers an empty list. Read with the same access as the rest of the render routes.
