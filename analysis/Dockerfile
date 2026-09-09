# The analysis sidecar. See analysis/README.md for the contract this serves and
# for why it is a separate program rather than app code.
#
# One reason lives in this file specifically: decoding does not happen in Node,
# so the decoder is here. If this container is ever folded back into the app,
# that is what is being given up, and it will not be visible in the diff.
#
# Not a licence boundary, though an earlier version of this comment said it was.
# analysis/README.md, under "The rule, stated once", keeps the analysis path permissive outright
# rather than relying on the process boundary to hold a copyleft dependency at
# arm's length, so there is nothing here for the boundary to carry.
FROM python:3.13-slim

# ffmpeg decodes; the service itself fetches. Keeping the fetch in Python is what
# holds it to ONE request per track: handing a URL to ffprobe and then to ffmpeg
# had each of them open and seek over HTTP, which measured at eight requests for
# one nine-megabyte track against the station's own provider credential.
# Installed as a binary and invoked as a subprocess, never linked.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

# Requirements before the source, so a code edit does not re-resolve the wheels.
COPY analysis/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# The beat tracker, WITHOUT its dependency list. The pin and the licence note for why it
# installs `--no-deps` both live in `requirements.nodeps.txt` now, which the root `Dockerfile`
# reads too — one file instead of a line each side that only one of them remembered to carry.
COPY analysis/requirements.nodeps.txt ./requirements.nodeps.txt
RUN pip install --no-cache-dir --no-deps -r requirements.nodeps.txt

# Named individually rather than `COPY analysis/*.py`, so the tests do not ride into the
# image. The cost is that this list is a second place a new module has to be added, and it
# has already been missed once: `tags.py` arrived with the ReplayGain read and was not added
# here, so the image built clean and then died on `from tags import gain_tags` every time it
# started. Nothing upstream noticed, because a sidecar that will not start looks exactly like
# a sidecar nobody called.
#
# It is a THIRD place, in fact, and the third is the one that gets forgotten: the root
# `Dockerfile` carries the same list for the single-container production image. A module added
# here and missed there builds clean and crash-loops in production while this container is fine.
#
# The beat tracker's pin isn't a fourth place any more. It lived only here for a while — the
# root Dockerfile never installed it at all, which is the crash-loop
# `docs/todo/comparable-stations.md` recorded. `requirements.nodeps.txt` above is the one place
# it is named now, read by both Dockerfiles, so there is nothing left to forget for that
# package. Only this module list still is.
COPY analysis/measure.py analysis/loudness.py analysis/tags.py analysis/join.py analysis/app.py ./

# Non-root: this service fetches URLs it was handed and runs a decoder over what
# comes back, which is the one process here that touches bytes from outside.
RUN useradd --system --uid 10001 analysis
USER analysis

ENV ANALYSIS_PORT=9321 MALLOC_ARENA_MAX=2
EXPOSE 9321

# One uvicorn worker regardless of ANALYSIS_WORKERS: the concurrency that
# matters is the decode pool inside the process, which app.py sizes and bounds
# with a semaphore. A second uvicorn worker would be a second pool with no
# knowledge of the first, so the ceiling an operator set would silently double.
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${ANALYSIS_PORT}"]
