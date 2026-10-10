---
'@deadair/api': minor
---

`curl -fsSL https://deadair.radio/install.sh | sh` installs the station with Docker Compose. It asks where to put it, which tag, which port and the station's address. Then it writes the compose file and `.env`, hands the data directory to the station's user, starts it, waits for the first boot and runs `deadair-doctor`. Running it again keeps the `.env` it finds.
