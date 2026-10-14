---
'@deadair/api': minor
---

The station can now send events to your own servers, such as a Home Assistant webhook trigger or an n8n workflow. Add an event destination with `POST /events/destinations` and its address; the answer carries the destination's signing secret, which is shown once (`POST /events/destinations/{id}/secret` makes a new one). `POST /events/destinations/{id}/test` sends it a test event and says what it answered, and `GET /events/destinations/{id}/deliveries` lists the latest attempts. Every delivery is a JSON POST signed in `Deadair-Webhook-Signature` with a timestamp in `Deadair-Webhook-Timestamp`. Addresses on your own network are fine; a redirect is never followed. Only the test event exists so far: the station's own moments, such as a record starting, follow in later releases. The same operations are in every SDK; the routes that return a secret are not MCP tools.
