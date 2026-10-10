---
title: Install with Docker Compose
description: The station's own compose file and environment file, filled in and started, step by step.
---

# Install with Docker Compose

By the end of this page the station is running under Docker Compose and you are signed in to its
console as the administrator. It takes about ten minutes, most of it the first boot.

This page uses the compose file and environment file the project ships in `deploy/`, with the `full`
variant, which brings its own database and cache. [Install](../install.md) is the reference: the other
variants, bringing your own PostgreSQL and Redis, a second disk for media, and putting the station on
the internet.

**You need:** a Linux machine on `amd64` with Docker and the Compose plugin (`docker compose version`
answers). Docker Desktop on a Mac or a PC works for trying it out.

## 1. Get the two files

Make a directory for the station and download the compose file and the example environment file into
it:

```bash
mkdir deadair && cd deadair
```

```bash
curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/robert-dean/deadair/main/deploy/docker-compose.yml
```

```bash
curl -fsSL -o .env https://raw.githubusercontent.com/robert-dean/deadair/main/deploy/.env.example
```

The second download is saved straight to `.env`, which is the file the compose file reads.

## 2. Fill in `.env`

Open `.env` in an editor. It is commented throughout. Change these lines and leave the rest alone:

```bash
VARIANT=full
APP_BASE_URL=http://192.168.1.10:8080
SPA_BASE_URL=http://192.168.1.10:8080
TZ=America/New_York
```

- **`VARIANT=full`** brings PostgreSQL and Redis inside the container, so every `DATABASE_` and `REDIS_`
  line stays empty.
- **The two addresses** are what you will type into a browser to reach the station: the machine's
  address and `HTTP_PORT` (8080 by default), with nothing after the port. Use `http://localhost:8080`
  if you will only open it on the same machine. A wrong address still lets the console load, but
  sign-in links and a Spotify authorization will send your browser nowhere.
  [Why](../install.md#the-stations-address).
- **`TZ`** is where the station is. It can be changed later in the console.
- **The two keys** stay empty. The station makes both on its first boot, in `data/secrets`. Back that
  directory up with the rest of `data`: losing the first key means entering every credential the
  station stored again.

## 3. Give the data directory to the station

The container runs as user 99, group 100. On most Linux hosts the `./data` directory has to be handed
over once:

```bash
mkdir -p data && sudo chown -R 99:100 ./data
```

Docker Desktop on a Mac does not need this.

## 4. Start it and watch the first boot

```bash
docker compose up -d
```

```bash
docker compose logs -f deadair
```

Wait for the line `Boot complete`, then press Ctrl+C to stop following the log (the station keeps
running). The first boot applies the database schema and can take a few minutes. `docker compose ps`
shows the container as `healthy` once it is answering.

## 5. Create the administrator

1. Open the address you put in `APP_BASE_URL`.
2. The console opens on **Set up deadair**. Enter an email address and a password and choose
   **Create administrator**.

That account is the only way in, so keep the password somewhere safe.

**You should now see** the console's Desk. The station is installed but has nothing to play yet.

## If it goes wrong

- **The container exits and the log names a variable.** That line in `.env` is empty.
- **The log says permission denied under `/data`.** Step 3 was skipped. Run the `chown` and
  `docker compose up -d` again.
- **The log says it cannot reach the database.** `VARIANT` is not `full`. Set it, or see
  [Bringing your own database](../install.md#bringing-your-own-database).
- **Port 8080 is already taken.** Change `HTTP_PORT` in `.env`, and the port in both addresses to
  match.

## Upgrading later

```bash
docker compose pull && docker compose up -d
```

The schema is brought up to date on every start, so there is no migration step. The `full` tag
follows `main` and moves often. [Install § Which tag](../install.md#which-tag) says how to pin a
release instead.

## Next

[Your first hour on air](./first-hour.md): give the station music, say who it is, and put something on.
