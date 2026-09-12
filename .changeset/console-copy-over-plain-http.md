---
'@deadair/web': patch
---

The console's Copy buttons work when it is opened over plain HTTP at a network address, such as `http://192.168.1.10:8080` on a home server. Before, they copied nothing there and said nothing either, because the browser only offers the clipboard function they used on HTTPS or on localhost. They now fall back to the browser's older way of copying, and if that is refused as well the button reads "Copy failed" and shows the text already selected, ready to copy with the keyboard. This covers the restart command on the silence diagnosis and the stale-config alert, the plugin OAuth callback URL, the authenticator key during enrolment, and the build revision and stream addresses on the check-up.
