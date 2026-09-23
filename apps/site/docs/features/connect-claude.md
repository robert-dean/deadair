---
title: Connecting Claude
sidebar_position: 13
description: Letting Claude, or any other app that speaks MCP, connect to the station as you, what it can then do, and how to take that back.
---

A station can let an app connect to it as one of its operators. Claude is the app this was built for:
add the station as a custom connector in Claude, approve it once, and Claude reaches the station
through its MCP endpoint as you. Any other MCP client that signs in with OAuth connects the same way.

The endpoint offers no tools yet. Connecting now proves the way in works; what Claude can do once it
is in comes next.

## Turning it on

It is off until you switch it on, so a station reachable from the internet does not start answering
an authorization flow because it was upgraded. In the console, open **Settings → Sign-in and
connections** and turn on **Let apps connect as you**. Leave **Apps may register themselves** on:
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
your answer goes to `claude.ai`, and choose **Allow**. If your account has an authenticator, you are
asked for a code first, as you are for creating an API key.

Claude Code works the same way. Its approval says the app runs on your own computer, and asks you to
allow it only if you have just started it there yourself.

## What it can do

Exactly what you can, and no more. An app connected by a listener can read what a listener can read;
one connected by an administrator can do what they can. It can never do what your account cannot,
and losing a role takes that away from the app too.

Its access works at the MCP endpoint only. The token it holds is refused by every other part of the
station's API, and the console's own sign-in is refused at the MCP endpoint.

## Taking it back

**Settings → Security** lists the apps you have connected. **Disconnect** stops one straight away:
the next thing it asks for is refused, and it has to be approved again to come back.

An operator can see every app registered with the station on **Settings → Sign-in and connections**,
and **Withdraw** one, which disconnects it from everybody at once. Apps that registered themselves
are deleted after ninety days of disuse; Claude registers a new one each time somebody connects it.
Turning **Let apps connect as you** off stops every connected app at once without disconnecting
anybody. Turning it back on lets them in again, unless one needed to renew its access while it was
off, in which case it has to be approved again.

## Apps that cannot register themselves

For a client that has to be given its details, register it by hand on **Settings → Sign-in and
connections**: a name, the addresses it may be sent back to, and whether it keeps a secret. Its client
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
