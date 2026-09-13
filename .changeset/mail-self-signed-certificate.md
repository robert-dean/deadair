---
'@deadair/api': patch
---

Mail works with a server that has a self-signed certificate. Settings → Mail has a new switch, "Check the server's certificate": turn it off and the station stops failing with "unable to verify the first certificate" against a mail server with its own certificate, or one from your own certificate authority. It stays on by default, and should for any server reached across the internet, because with it off the station cannot tell your server from something pretending to be it.
