# The audio-url resolver, for the DEV stack. The production image builds the same
# service into itself (root `Dockerfile`) and supervises it with s6.
#
# No ffmpeg and no native anything: this service resolves an address and never
# decodes, downloads or transcodes a byte.
FROM python:3.13-slim

WORKDIR /srv

# Pins first, source second, so editing `resolve.py` reinstalls nothing.
COPY ytaudio/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# The module list is the SECOND copy of the one in the root Dockerfile. A file
# added here and not there builds clean and crash-loops in production while this
# container is perfectly happy. Adding one means editing both.
COPY ytaudio/resolve.py ytaudio/app.py ./

RUN useradd --system --uid 10002 ytaudio
USER ytaudio

ENV YTAUDIO_PORT=9322
EXPOSE 9322
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${YTAUDIO_PORT}"]
