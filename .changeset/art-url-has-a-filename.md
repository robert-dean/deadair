---
'@deadair/api': patch
---

Cached artwork is served under a filename as well as under its id: `GET /art/{id}/{filename}` answers the same bytes, chosen by the id, and catalog reads now mint `art/<id>/cover.<ext>` from the extension the store recorded. This is what a hardware player needs before it will fetch a cover at all, since it decides whether a URL is a picture by looking at the URL rather than by asking. An asset with no recorded extension keeps its bare `art/<id>`, and every existing URL still works.
