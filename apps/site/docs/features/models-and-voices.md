---
title: Models and voices
sidebar_position: 10
description: Which model writes which words, which voice speaks them, how a script becomes audio, and why the station keeps talking with no model at all.
---

The station's words can come from a language model and its voice from a speech engine, both [plugins](./plugins.md). With no model it writes its own breaks from its phrasings; with no voice it plays records. A model makes the presenter better. It never stands between the station and silence.

![Settings, Words: which plugin the station asks for words, and a model for each job](/img/console/settings.llm.webp)
*Fig. 1. Settings → Words.*

## Talking without a model

Every break has more than one writer, tried in order: a model first, if you have switched it on, and behind it the station's own phrasings. They are the floor: instant, and unable to fail, so a model that is slow, missing or failed a check costs a better sentence rather than a silent station. The phrasings are yours to edit under Settings → Rotation, one per line, and clearing the box restores the station's own rather than silencing it. See [breaks](./breaks.md).

A model writing the talk breaks is off by default, and so is a model choosing the records. See [the programme](./programme.md) for what the station does instead.

## One plugin, as many providers as you add

The language model plugin keeps a table of providers. Each row has a name you choose and a kind: **OpenAI-compatible** (a local Ollama or vLLM, or OpenAI, Groq, Mistral and OpenRouter at their own addresses), **Anthropic**, or **Gemini**.

The name is how a model is addressed: a model on the row you called `ollama` is `ollama:gpt-oss`, and one on the row you called `claude` is `claude:claude-sonnet-5`. A model named without its provider is refused rather than guessed at. An API key typed into the table is encrypted, never shown again and never returned by the API. For OpenAI-compatible providers you also tick which models can be given tools, because no such server reports it.

## A model for each job

Settings → Words names the plugin the station asks, then gives each job its own switch and its own model: the talk breaks listeners hear; choosing records, which is research rather than a sentence; reading articles for trivia, with a second call checking each fact against the words that state it; reading each character back to itself, nightly; thinking up things your characters have lived through, nightly, none of which airs until you keep it; and writing a character when you press Write. So a station can write its breaks on a hosted model and do its reading on a local one, picking names from what your providers actually offer.

The station asks its model one thing at a time, because a local model is one set of weights on one graphics card. A talk break waits its turn only so long before the phrasings write it, and background jobs run at the lowest priority, so a break always gets the model first. The station puts no cap on what a hosted provider bills; Check-up → What it cost lists every call.

## Voices

Two speech plugins are bundled:

- **Kokoro** speaks through any OpenAI-compatible speech server, and ships pointed at the Kokoro server in the `latest` and `full` images. A voice can be a blend, such as `af_bella(2)+af_sky(1)`.
- **Chatterbox** reads from reference clips rather than named presets. It manages its model on the graphics card, and can let it go after a quiet spell (15 minutes by default), which matters when a local language model wants the same card.

The `slim` image brings no voice: point a speech plugin at a machine with a graphics card.

A voice is a name the station uses, such as `host`, `newsreader` or a character's own, and each speech plugin's Voices table says what that name sounds like on its engine. Where the engine can perform, a script may carry a cue: a presenter may laugh, chuckle, sigh or gasp, and a caller on a [phone-in](./phone-ins.md) may also cough, clear their throat, sniff or groan, because on a telephone that is the realism. Only cues the loaded engine reports are offered.

## From words to audio

Writing a break and speaking it are separate stages, so a failed render is retried with the words already written. A break whose audio is not ready when its turn comes is skipped, never waited for, so a broken speech engine cannot cost the station silence. The voice is levelled like the records and kept slightly under them, by an amount set under Settings → Playout.

A character can also have a soundboard, short sounds it may hit mid-sentence. None ships with the station: anything this project redistributed would have to be public domain, and none has been sourced. Upload your own.

## How a word is said

Pronunciations are a table. The station fills it from the pronunciation keys printed in Wikipedia articles it already holds. Where it is sure which word a key belongs to it uses the entry; where it is not it proposes one, which is not said until you accept it, and a rejected one stays rejected. Figures are rewritten before an engine sees them, so "$17.1 billion" is read as "17.1 billion dollars", and a price in front of a noun as "a 100 billion dollar spaceport".

## In the console

**Settings → Words** for the model per job; the language model plugin's page, under Settings → Plugins, for the providers; **Settings → Voice and audio** for which speech plugin speaks. **Voice** in the rail, or the V key, holds Voices (with a preview of each), Pronunciations, Soundboard, and What it said: every break written, and every one declined.
