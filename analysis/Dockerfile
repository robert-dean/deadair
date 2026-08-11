# The analysis sidecar. See analysis/README.md for the contract this serves and
# for why it is a separate program rather than app code.
#
# Two reasons live in this file specifically. Decoding does not happen in Node,
# so the decoder is here. And the toolkits the deferred beat layer will need are
# mostly copyleft, several AGPL, which is a materially different position for a
# separate program speaking HTTP than for a library linked into the API server.
# If this container is ever folded back into the app, that is what is being given
# up, and it will not be visible in the diff.
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

COPY analysis/measure.py analysis/loudness.py analysis/app.py ./

# Non-root: this service fetches URLs it was handed and runs a decoder over what
# comes back, which is the one process here that touches bytes from outside.
RUN useradd --system --uid 10001 analysis
USER analysis

ENV ANALYSIS_PORT=9321
EXPOSE 9321

# One uvicorn worker regardless of ANALYSIS_WORKERS: the concurrency that
# matters is the decode pool inside the process, which app.py sizes and bounds
# with a semaphore. A second uvicorn worker would be a second pool with no
# knowledge of the first, so the limit an operator set would silently double.
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${ANALYSIS_PORT}"]
