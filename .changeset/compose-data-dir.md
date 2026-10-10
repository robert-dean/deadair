---
'@deadair/api': patch
---

A Compose install set up from `deploy/.env.example` now starts. That file's `DATA_DIR=./data` is the host side of the volume, but `env_file` handed it to the container as well. Inside, the station read it as where its data lives, so the database was never initialised, the cache refused its config and the voice could not find its model. `deploy/docker-compose.yml` now fixes the container's `DATA_DIR` at `/data` whatever `.env` says. Unraid installs were not affected.
