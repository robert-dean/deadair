"""Does a BluOS player show artwork carried in the ICY `StreamUrl` field?

The question the earlier probes never asked. ICY carries two fields per update, not one:
`StreamTitle`, which every player reads, and `StreamUrl`, which Radio Paradise and others fill
with a cover-art URL and which some players render. Icecast 2.5 passes the `url` argument of
`/admin/metadata` straight into it (2.4 silently dropped it), so if a player honours the field,
per-record art on a hardware display costs the station one extra metadata key and no reconnect.

This measures it against a TEST MOUNT rather than the station's, so the live mount and the
running station are untouched. It stands up a throwaway Icecast 2.5.0 in Docker on this
machine, feeds it `station-id.mp3` on a loop from a source client written here, rotates the
metadata every few seconds between distinct artwork URLs, and serves those images itself so
that the player FETCHING one is a fact this script sees, whatever the player then draws.

It answers in three stages, each of which can stop the run:

  1. Does Icecast put `StreamUrl` on the wire? A listener written here connects with
     `Icy-MetaData: 1` and prints the raw blocks. No `StreamUrl` means the rest is moot.
  2. Does the player FETCH the image? The art server logs every request with its client
     address, so a player that reads the field and ignores it is told apart from one that
     never reads it.
  3. Does the player SHOW it, and does it follow the record? `/Status` is long-polled and
     `image`, `stationImage` and the three title lines are printed on every change, then
     compared with the URLs that were sent.

Stage 1 alone: `--no-player`. It touches nothing but this machine and Docker.

The player is found with LSDP (UDP 11430, the protocol the BluOS spec recommends over mDNS)
unless `--player` names it. Playing the test mount is a real `/Play?url=` on a real amp, at
whatever volume it is set to, and the run ends by putting back what the player was doing
when it started: the same URL stream if it was streaming one, `/Stop` otherwise. The mount it
points the player at is this machine's LAN address, so the two have to be on one network.

See stream/README.md for how to run it and for what the earlier probes found.
"""

from __future__ import annotations

import argparse
import base64
import http.server
import re
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zlib
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
SAMPLE = HERE / "station-id.mp3"

ICECAST_IMAGE = "libretime/icecast:2.5.0"
CONTAINER = "deadair-streamurl-check"
MOUNT = "/probe.mp3"
SOURCE_USER = "source"
PASSWORD = "probe"

LSDP_PORT = 11430
BLUOS_PORT = 11000

# Distinct solid colours, so the log and the screen can be matched by eye as well as by URL.
ART = [
    ("red", (220, 40, 40)),
    ("green", (40, 180, 80)),
    ("blue", (40, 90, 220)),
    ("yellow", (240, 200, 40)),
    ("magenta", (200, 40, 200)),
    ("cyan", (40, 200, 220)),
]


def log(message: str) -> None:
    print(f"{time.strftime('%H:%M:%S')}  {message}", flush=True)


# --- the throwaway Icecast -------------------------------------------------------------------


def icecast_config(hostname: str) -> str:
    # The mount carries its own username and password for the reason icecast.xml.tmpl records at
    # length: on 2.5.0 a mount-scoped /admin/metadata is authorised against the MOUNT's
    # credentials, and a mount that declares none answers 401 to every metadata update.
    return f"""<icecast>
  <limits>
    <clients>10</clients><sources>2</sources><queue-size>524288</queue-size>
    <client-timeout>30</client-timeout><header-timeout>15</header-timeout><source-timeout>10</source-timeout>
    <burst-on-connect>1</burst-on-connect><burst-size>65536</burst-size>
  </limits>
  <authentication>
    <source-password>{PASSWORD}</source-password><relay-password>{PASSWORD}</relay-password>
    <admin-user>admin</admin-user><admin-password>{PASSWORD}</admin-password>
  </authentication>
  <hostname>{hostname}</hostname>
  <listen-socket><port>8000</port></listen-socket>
  <mount type="normal">
    <username>{SOURCE_USER}</username><password>{PASSWORD}</password>
    <mount-name>{MOUNT}</mount-name>
    <stream-name>Deadair StreamUrl probe</stream-name>
    <public>0</public>
  </mount>
  <fileserve>1</fileserve>
  <paths>
    <logdir>/var/log/icecast</logdir>
    <webroot>/usr/share/icecast/web</webroot>
    <adminroot>/usr/share/icecast/admin</adminroot>
  </paths>
  <logging><loglevel>3</loglevel></logging>
</icecast>
"""


class Icecast:
    """One Icecast 2.5.0 container, configured through stdin so nothing is bind-mounted."""

    def __init__(self, hostname: str, port: int) -> None:
        self.port = port
        self.hostname = hostname
        self.process: subprocess.Popen[bytes] | None = None

    def start(self) -> None:
        subprocess.run(["docker", "rm", "-f", CONTAINER], capture_output=True, check=False)
        self.process = subprocess.Popen(
            [
                "docker", "run", "--rm", "-i", "--name", CONTAINER,
                "-p", f"0.0.0.0:{self.port}:8000", ICECAST_IMAGE,
                "sh", "-c", "cat > /tmp/probe.xml; exec icecast -c /tmp/probe.xml",
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        assert self.process.stdin is not None
        self.process.stdin.write(icecast_config(self.hostname).encode())
        self.process.stdin.close()
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/status-json.xsl", timeout=2):
                    return
            except (urllib.error.URLError, ConnectionError, TimeoutError, OSError):
                time.sleep(0.5)
        raise RuntimeError("Icecast did not come up within 30s (is Docker running?)")

    def stop(self) -> None:
        subprocess.run(["docker", "rm", "-f", CONTAINER], capture_output=True, check=False)
        if self.process is not None:
            self.process.wait(timeout=10)

    def update_metadata(self, song: str, url: str | None) -> None:
        # The same call Liquidsoap makes, with the same credential: the mount's own.
        query = {"mode": "updinfo", "mount": MOUNT, "song": song}
        if url is not None:
            query["url"] = url
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}/admin/metadata?{urllib.parse.urlencode(query)}")
        request.add_header("Authorization", basic(SOURCE_USER, PASSWORD))
        with urllib.request.urlopen(request, timeout=5) as response:
            body = response.read().decode(errors="replace")
        if "Metadata update successful" not in body:
            raise RuntimeError(f"metadata update refused: {body.strip()[:200]}")


def basic(user: str, password: str) -> str:
    return "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()


# --- the source client -----------------------------------------------------------------------

BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
SAMPLE_RATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def mp3_frames(data: bytes) -> list[tuple[bytes, float]]:
    """Every Layer III frame in the file with its duration, so the loop is paced and frame-aligned."""
    at = 0
    if data[:3] == b"ID3":
        size = (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9]
        at = 10 + size + (10 if data[5] & 0x10 else 0)
    frames: list[tuple[bytes, float]] = []
    while at + 4 <= len(data):
        header = struct.unpack(">I", data[at : at + 4])[0]
        version = (header >> 19) & 3
        layer = (header >> 17) & 3
        bitrate_index = (header >> 12) & 15
        rate_index = (header >> 10) & 3
        if (header >> 21) != 0x7FF or version == 1 or layer != 1 or bitrate_index in (0, 15) or rate_index == 3:
            at += 1
            continue
        padding = (header >> 9) & 1
        rate = SAMPLE_RATES[version][rate_index]
        if version == 3:
            bitrate, samples, factor = BITRATES_V1[bitrate_index], 1152, 144
        else:
            bitrate, samples, factor = BITRATES_V2[bitrate_index], 576, 72
        length = factor * bitrate * 1000 // rate + padding
        if at + length > len(data):
            break
        frames.append((data[at : at + length], samples / rate))
        at += length
    if not frames:
        raise RuntimeError(f"no MPEG frames found in {SAMPLE}")
    return frames


class Source(threading.Thread):
    """Streams the sample on a loop into the mount, paced to real time, one second ahead."""

    def __init__(self, port: int) -> None:
        super().__init__(daemon=True, name="source")
        self.port = port
        self.frames = mp3_frames(SAMPLE.read_bytes())
        self.stop_event = threading.Event()
        self.connected = threading.Event()
        self.error: str | None = None

    def run(self) -> None:
        try:
            with socket.create_connection(("127.0.0.1", self.port), timeout=10) as sock:
                sock.sendall(
                    (
                        f"PUT {MOUNT} HTTP/1.1\r\n"
                        f"Host: 127.0.0.1:{self.port}\r\n"
                        f"Authorization: {basic(SOURCE_USER, PASSWORD)}\r\n"
                        "Content-Type: audio/mpeg\r\n"
                        "Ice-Public: 0\r\n"
                        "Ice-Name: Deadair StreamUrl probe\r\n"
                        "Expect: 100-continue\r\n\r\n"
                    ).encode()
                )
                status = sock.recv(1024).decode(errors="replace").split("\r\n")[0]
                if " 100 " not in status and " 200 " not in status:
                    raise RuntimeError(f"source connection refused: {status}")
                self.connected.set()
                sock.settimeout(None)
                started = time.monotonic()
                sent = 0.0
                while not self.stop_event.is_set():
                    for frame, duration in self.frames:
                        if self.stop_event.is_set():
                            break
                        sock.sendall(frame)
                        sent += duration
                        ahead = started + sent - 1.0 - time.monotonic()
                        if ahead > 0:
                            time.sleep(ahead)
        except Exception as error:  # noqa: BLE001 - reported to the main thread, which decides
            self.error = str(error)
            self.connected.set()


# --- the art server --------------------------------------------------------------------------


def png(colour: tuple[int, int, int], size: int = 256) -> bytes:
    row = b"\x00" + bytes(colour) * size
    raw = zlib.compress(row * size, 9)

    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")


@dataclass
class ArtHit:
    at: float
    client: str
    path: str
    agent: str


@dataclass
class ArtServer:
    """Serves the artwork the metadata points at, and remembers who asked for it."""

    port: int
    hits: list[ArtHit] = field(default_factory=list)
    images: dict[str, bytes] = field(default_factory=lambda: {f"/art/{name}.png": png(colour) for name, colour in ART})

    def start(self) -> None:
        server = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802 - the stdlib's name
                server.hits.append(ArtHit(time.time(), self.client_address[0], self.path, self.headers.get("User-Agent", "")))
                body = server.images.get(self.path.split("?")[0])
                if body is None:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_: object) -> None:
                pass

        httpd = http.server.ThreadingHTTPServer(("0.0.0.0", self.port), Handler)
        threading.Thread(target=httpd.serve_forever, daemon=True, name="art").start()


# --- stage 1: what is on the wire -----------------------------------------------------------


def read_icy_blocks(host: str, port: int, want: int, timeout: float) -> list[str]:
    """Connects as a listener and returns the first non-empty ICY metadata blocks it is sent."""
    blocks: list[str] = []
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.sendall(f"GET {MOUNT} HTTP/1.0\r\nHost: {host}\r\nIcy-MetaData: 1\r\nUser-Agent: deadair-streamurl-check\r\n\r\n".encode())
        buffer = b""
        while b"\r\n\r\n" not in buffer:
            piece = sock.recv(4096)
            if not piece:
                raise RuntimeError("the mount closed the connection before sending headers")
            buffer += piece
        headers, rest = buffer.split(b"\r\n\r\n", 1)
        match = re.search(rb"(?im)^icy-metaint:\s*(\d+)", headers)
        if match is None:
            raise RuntimeError("the mount sent no icy-metaint header, so it is not sending ICY metadata at all")
        interval = int(match.group(1))
        deadline = time.monotonic() + timeout

        def take(count: int) -> bytes:
            nonlocal rest
            while len(rest) < count:
                if time.monotonic() > deadline:
                    raise TimeoutError("timed out reading the mount")
                piece = sock.recv(65536)
                if not piece:
                    raise RuntimeError("the mount closed the connection")
                rest += piece
            out, rest = rest[:count], rest[count:]
            return out

        while len(blocks) < want and time.monotonic() < deadline:
            take(interval)
            length = take(1)[0] * 16
            if length:
                text = take(length).rstrip(b"\x00").decode("utf-8", errors="replace")
                if not blocks or blocks[-1] != text:
                    blocks.append(text)
    return blocks


# --- the player ------------------------------------------------------------------------------


@dataclass
class Player:
    address: str
    port: int = BLUOS_PORT

    def get(self, path: str, query: dict[str, str] | None = None, wait: float = 10) -> ET.Element:
        # `query` is a dict rather than keyword arguments because one of BluOS's own parameters
        # is called `timeout`, and a long poll passes it beside this request's own deadline.
        suffix = ("?" + urllib.parse.urlencode(query)) if query else ""
        with urllib.request.urlopen(f"http://{self.address}:{self.port}/{path}{suffix}", timeout=wait) as response:
            return ET.fromstring(response.read())

    def status(self, etag: str | None = None, hold: int | None = None) -> ET.Element:
        query: dict[str, str] = {}
        if etag:
            query["etag"] = etag
        if hold:
            query["timeout"] = str(hold)
        return self.get("Status", query, wait=(hold or 0) + 15)


STATUS_FIELDS = ("state", "secs", "service", "streamUrl", "title1", "title2", "title3", "image", "stationImage", "volume")


def reading(status: ET.Element) -> dict[str, str]:
    return {name: (status.findtext(name) or "") for name in STATUS_FIELDS} | {"etag": status.get("etag", "")}


def lsdp_query(unicast_reply: bool) -> bytes:
    # [6][L S D P][version 1] then [5][type][one class][player class], as LsdpPacket.Query builds it.
    return bytes([6]) + b"LSDP" + bytes([1, 5, ord("R") if unicast_reply else ord("Q"), 1, 0, 1])


def lsdp_announces(datagram: bytes) -> list[tuple[str, dict[str, str]]]:
    """(address, text) for every player-class record in an LSDP announce; nothing for anything else."""
    found: list[tuple[str, dict[str, str]]] = []
    if len(datagram) < 6 or datagram[0] < 6 or datagram[1:5] != b"LSDP":
        return found
    at = datagram[0]
    while at < len(datagram):
        length = datagram[at]
        if length < 2 or at + length > len(datagram):
            break
        if datagram[at + 1] == ord("A"):
            body = datagram[at + 2 : at + length]
            cursor = 0

            def take() -> bytes | None:
                nonlocal cursor
                if cursor >= len(body):
                    return None
                size = body[cursor]
                cursor += 1
                if cursor + size > len(body):
                    return None
                value = body[cursor : cursor + size]
                cursor += size
                return value

            node, address = take(), take()
            if node is not None and address is not None and len(address) == 4 and cursor < len(body):
                count = body[cursor]
                cursor += 1
                for _ in range(count):
                    if cursor + 3 > len(body):
                        break
                    class_id = struct.unpack(">H", body[cursor : cursor + 2])[0]
                    pairs = body[cursor + 2]
                    cursor += 3
                    text: dict[str, str] = {}
                    for _ in range(pairs):
                        key, value = take(), take()
                        if key is None or value is None:
                            break
                        text[key.decode(errors="replace")] = value.decode(errors="replace")
                    if class_id == 1:
                        found.append((socket.inet_ntoa(address), text))
        at += length
    return found


def broadcast_addresses() -> list[str]:
    addresses = ["255.255.255.255"]
    try:
        output = subprocess.run(["ifconfig"], capture_output=True, text=True, check=False).stdout
        addresses.extend(sorted(set(re.findall(r"broadcast (\d+\.\d+\.\d+\.\d+)", output))))
    except OSError:
        pass
    return addresses


def discover_players(window: float = 3.5) -> dict[str, dict[str, str]]:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    if hasattr(socket, "SO_REUSEPORT"):
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    unicast = False
    try:
        sock.bind(("", LSDP_PORT))
    except OSError:
        # The BluOS controller app holds the port; ask for the answer to come straight back.
        unicast = True
        sock.bind(("", 0))
    question = lsdp_query(unicast)
    targets = broadcast_addresses()
    players: dict[str, dict[str, str]] = {}
    sock.settimeout(0.25)
    started = time.monotonic()
    asked = 0
    while time.monotonic() - started < window:
        if asked < 3 and time.monotonic() - started >= asked:
            for target in targets:
                try:
                    sock.sendto(question, (target, LSDP_PORT))
                except OSError:
                    pass
            asked += 1
        try:
            datagram, _ = sock.recvfrom(4096)
        except socket.timeout:
            continue
        for address, text in lsdp_announces(datagram):
            players[address] = text
    sock.close()
    return players


def own_address_towards(player: str) -> str:
    """The address of whichever interface reaches the player, which is what the player must be told."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.connect((player, BLUOS_PORT))
        return sock.getsockname()[0]


# --- the run ---------------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--player", help="the BluOS player's address (default: ask the network with LSDP)")
    parser.add_argument("--host", help="this machine's address as the player should reach it (default: derived)")
    parser.add_argument("--icecast-port", type=int, default=8100)
    parser.add_argument("--art-port", type=int, default=8101)
    parser.add_argument("--period", type=float, default=20.0, help="seconds between artwork changes")
    parser.add_argument("--cycles", type=int, default=4, help="how many artwork changes to watch the player through")
    parser.add_argument("--no-player", action="store_true", help="stage 1 only: prove the wire and touch no player")
    parser.add_argument("--discover", action="store_true", help="list the players that answer LSDP, and do nothing else")
    args = parser.parse_args()

    if args.discover:
        for address, text in discover_players().items():
            print(f"{address}  {text.get('name', '?')}  {text.get('model', '?')}  {text.get('version', '?')}")
        return 0

    player: Player | None = None
    if not args.no_player:
        if args.player:
            player = Player(args.player)
        else:
            log("asking the network for BluOS players (LSDP, 3.5s)")
            players = discover_players()
            if not players:
                print("no player answered; pass --player <address>", file=sys.stderr)
                return 2
            for address, text in players.items():
                log(f"  {address}  {text.get('name', '?')}  {text.get('model', '?')}  {text.get('version', '?')}")
            if len(players) > 1:
                print("more than one player answered; pass --player <address>", file=sys.stderr)
                return 2
            player = Player(next(iter(players)))

    host = args.host or (own_address_towards(player.address) if player else "127.0.0.1")
    mount_url = f"http://{host}:{args.icecast_port}{MOUNT}"
    art_urls = [f"http://{host}:{args.art_port}/art/{name}.png" for name, _ in ART]

    icecast = Icecast(host, args.icecast_port)
    art = ArtServer(args.art_port)
    source: Source | None = None
    prior: dict[str, str] | None = None
    try:
        log(f"starting {ICECAST_IMAGE} as {CONTAINER} on {host}:{args.icecast_port}")
        icecast.start()
        art.start()
        source = Source(args.icecast_port)
        source.start()
        source.connected.wait(15)
        if source.error:
            print(f"the source could not feed the mount: {source.error}", file=sys.stderr)
            return 1
        log(f"mount is up: {mount_url}")

        # Stage 1: is StreamUrl on the wire at all?
        icecast.update_metadata("Probe Artist - Probe Record 1", art_urls[0])
        blocks = read_icy_blocks("127.0.0.1", args.icecast_port, want=1, timeout=20)
        for block in blocks:
            log(f"ICY block: {block}")
        if not any("StreamUrl='" in block for block in blocks):
            print("\nNO: Icecast sent no StreamUrl. Nothing downstream can be measured.", file=sys.stderr)
            return 1
        log("stage 1: Icecast puts StreamUrl on the wire")
        if player is None:
            print("\nStage 1 passed, and no player was asked (--no-player).")
            return 0

        # Stage 2 and 3: the player.
        # /SyncStatus answers in attributes rather than elements, unlike /Status.
        sync = player.get("SyncStatus").attrib
        log(f"player: {sync.get('name')} ({sync.get('brand')} {sync.get('modelName') or sync.get('model')}, firmware {sync.get('version') or sync.get('schemaVersion') or '?'})")
        prior = reading(player.status())
        log(f"before: state={prior['state']} service={prior['service']} streamUrl={prior['streamUrl']} volume={prior['volume']}")
        log(f"/Play?url={mount_url}")
        played = player.get("Play", {"url": mount_url})
        log(f"player answered state={played.text}")

        seen: list[dict[str, str]] = []
        stop_watching = threading.Event()

        def watch() -> None:
            etag = None
            last: dict[str, str] | None = None
            while not stop_watching.is_set():
                try:
                    current = reading(player.status(etag, hold=10))
                except (urllib.error.URLError, TimeoutError, OSError, ET.ParseError) as error:
                    log(f"status read failed: {error}")
                    time.sleep(2)
                    continue
                etag = current["etag"]
                shown = {k: v for k, v in current.items() if k not in ("etag", "secs", "volume")}
                if last is None or shown != {k: v for k, v in last.items() if k not in ("etag", "secs", "volume")}:
                    seen.append(current)
                    log("status: " + "  ".join(f"{k}={v}" for k, v in current.items() if k != "etag" and v))
                last = current

        threading.Thread(target=watch, daemon=True, name="watch").start()

        hits_reported = 0
        for cycle in range(1, args.cycles + 1):
            index = cycle % len(ART)
            icecast.update_metadata(f"Probe Artist - Probe Record {cycle + 1}", art_urls[index])
            log(f"metadata -> record {cycle + 1}, art {ART[index][0]}")
            until = time.monotonic() + args.period
            while time.monotonic() < until:
                time.sleep(0.5)
                while hits_reported < len(art.hits):
                    hit = art.hits[hits_reported]
                    hits_reported += 1
                    log(f"art fetched: {hit.path} by {hit.client} ({hit.agent or 'no agent'})")
        stop_watching.set()

        fetched_by_player = [hit for hit in art.hits if hit.client == player.address]
        shown = [s for s in seen if s["image"] in art_urls or s["stationImage"] in art_urls]
        distinct_shown = {s["image"] for s in shown if s["image"] in art_urls} | {s["stationImage"] for s in shown if s["stationImage"] in art_urls}
        print()
        print(f"stage 2, fetched: {'YES' if fetched_by_player else 'NO'} ({len(fetched_by_player)} request(s) from the player)")
        print(f"stage 3, shown:   {'YES' if shown else 'NO'} ({len(distinct_shown)} distinct artwork URL(s) reported in /Status)")
        if len(distinct_shown) >= 2:
            print("\nYES: the player renders StreamUrl and follows it across updates. Per-record art works on this player.")
        elif shown or fetched_by_player:
            print("\nPARTLY: the player reads StreamUrl but did not follow every change. Read the log above before deciding.")
        else:
            print("\nNO: the player never fetched nor reported the artwork. StreamUrl is not honoured on this firmware.")
        return 0
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        return 130
    finally:
        if player is not None and prior is not None:
            try:
                if prior["state"] in ("stream", "play", "connecting") and prior["streamUrl"]:
                    answer = player.get("Play", {"url": prior["streamUrl"]})
                    log(f"restored the player to its earlier stream: state={answer.text} url={prior['streamUrl']}")
                    if answer.text not in ("stream", "play", "connecting"):
                        log("the player did not take that URL back; put it back from the BluOS app")
                else:
                    player.get("Stop")
                    log("stopped the player, which was not streaming a URL before")
            except (urllib.error.URLError, TimeoutError, OSError, ET.ParseError) as error:
                log(f"could not restore the player ({error}); put it back from the BluOS app")
        if source is not None:
            source.stop_event.set()
        icecast.stop()
        log("cleaned up")


if __name__ == "__main__":
    sys.exit(main())
