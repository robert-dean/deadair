---
'@deadair/api': minor
'@deadair/web': minor
---

The station now says when a newer release is out. The console's header names it, **Check-up > What’s new** lists it first with its notes and a link to its release page, and the Build section of Check-up says so. The station asks GitHub for the project's public list of releases once when it starts and then every six hours. **Check now** on What’s new asks straight away. Each request is anonymous and carries nothing about the station. It never installs anything: upgrading is still pulling the new image.

It is **on** by default. Turn it off under **Settings > Station > Check for new releases**, and it sends nothing at all. A station that follows `latest` is told about a release only once one is out that it has not already picked up from `main`.
