---
'@deadair/api': minor
---

The station now restarts its audio chain when it gets stuck. The audio chain can stop playing what it is handed while still looking alive, which leaves listeners on the fallback bed until somebody restarts the container. Now, if it holds a record for a minute without playing it, or does not answer at all for a minute, the station asks for it to be restarted, and it is back within about twenty seconds with the running order where it was. It asks at most once every five minutes and gives up after three restarts that did not help, and every restart, and giving up, is in the activity feed. A stuck audio chain is also now killed after ten seconds if it will not stop on its own, including when a stream setting changes. The new "Restart the audio chain when it gets stuck" setting under Playout is on by default; turn it off to leave a stuck chain alone and look at it.
