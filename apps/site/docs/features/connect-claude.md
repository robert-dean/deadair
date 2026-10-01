---
title: Connecting Claude
sidebar_position: 13
description: Letting Claude, or any other app that speaks MCP, connect to the station as you, what it can then do, and how to take that back.
---

A station can let an app connect to it as one of its operators. Claude is the app this was built for:
add the station as a custom connector in Claude, approve it once, and Claude reaches the station
through its MCP endpoint as you. Any other MCP client that signs in with OAuth connects the same way.

Once it is in, Claude can tell you what is on air, run the station for you and change it, as far as
you let it when you approve it. See [what it can do](#what-it-can-do).

## Turning it on

It is off until you switch it on, so a station reachable from the internet does not start answering
an authorization flow because it was upgraded. In the console, open **Settings → Sign-in and
security** and turn on **Let apps connect as you**. Leave **Apps may register themselves** on:
that is how Claude connects without anybody setting it up first.

The station must know its own public address, the one set as `APP_BASE_URL` (on unraid, **Public
address**). It is the address Claude is given, the one the station tells Claude to come back to, and
the one it signs everything with. A station reached only on your own network can be connected from
Claude Code on the same network, but not from Claude on the web or on a phone, which reach it from
Anthropic's servers.

## Adding the connector

In Claude, add a custom connector and give it your station's public address followed by `/api/mcp`:

```
https://radio.example.com/api/mcp
```

Leave the client id and secret empty. Claude registers itself with the station, then sends you to the
station's console to approve it. Sign in if you are not already, check that it names Claude and that
your answer goes to `claude.ai`, choose what it may do, and choose **Allow**. **Read only**, the
default, lets it see what is on air, the schedule and the library, and ask for records. **Read and
manage** lets it change the station too: skip, run the schedule, edit characters and playlists. If your account has an authenticator, you are
asked for a code first, as you are for creating an API key.

Claude Code works the same way. Its approval says the app runs on your own computer, and asks you to
allow it only if you have just started it there yourself.

## What it can do

A handful of tools are offered to Claude up front, for the things people ask for most:

- what is playing now, and whether the station is on air and why not
- the timetable, and which show is on
- searching for a record a listener may ask for, asking for one, and the requests you have made
- skipping what is on air
- who it is connected as, and what it may do

Everything else the console does is one search away. Claude is given `search_api`, which finds any of
the station's operations by what it does, and `call_api`, which runs the one it found: the running
order, the library and its ratings, characters and their stories, playlists, the timetable and the
format clock, podcasts, productions, plugins, the check-up and more. So "put the soul show on at
ten", "what did the late-night host say about that record" or "why is it quiet" are all things
you can just ask. Claude is told to check with you before anything that deletes or undoes, and every
call it makes this way is written to the station's log.

A few things are never offered, whatever your role: signing in and credentials, connected apps,
first-run setup, plugin configuration and sign-in, changing the station's settings (it can read
them) and its log files. Those stay in the console.

Beyond that, it can do exactly what you can, and no more. An app connected by a listener can read
what a listener can read; one connected by an administrator can do what they can, if it was allowed
to manage. It can never do what your account cannot, and losing a role takes that away from the app
too.

Its access works at the MCP endpoint only. The token it holds is refused by every other part of the
station's API, and the console's own sign-in is refused at the MCP endpoint.

## Taking it back

**Settings → Sign-in and security** lists the apps you have connected. **Disconnect** stops one straight away:
the next thing it asks for is refused, and it has to be approved again to come back.

An operator can see every app registered with the station on **Settings → Sign-in and security**,
and **Withdraw** one, which disconnects it from everybody at once. Apps that registered themselves
are deleted after ninety days of disuse; Claude registers a new one each time somebody connects it.
Turning **Let apps connect as you** off stops every connected app at once without disconnecting
anybody. Turning it back on lets them in again, unless one needed to renew its access while it was
off, in which case it has to be approved again.

## Apps that cannot register themselves

For a client that has to be given its details, register it by hand on **Settings → Sign-in and
security**: a name, the addresses it may be sent back to, and whether it keeps a secret. Its client
id and, if it has one, its secret are shown once. Give them to the client, and point it at the same
`/api/mcp` address.

## If it does not connect

- **Claude says it could not reach the server.** Check that `https://<your address>/.well-known/oauth-authorization-server`
  answers with a JSON document naming your address as its `issuer`. A 404 means the switch is off; a
  page of the console instead means whatever is in front of the station is not passing `/.well-known/`
  through to it.
- **The approval page says the request cannot be answered.** The app asked to be sent back somewhere
  it did not register, or named an app the station does not know. Nothing was sent anywhere; remove
  the connector and add it again.
- **It connected once and stopped.** Somebody disconnected or withdrew it, or the switch was turned
  off. Reconnect it from Claude.
