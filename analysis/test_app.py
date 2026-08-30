"""The plumbing in `app.py` that can be exercised without HTTP or a decoder.

Almost everything in that file is a subprocess, a socket or a thread pool, and is
covered end to end by the station rather than here. What is left is the handful
of pure parses -- and one of them runs ONLY in the container, on a kernel the
machine this is written on does not have, which is the case worth a test more
than any of the others.

    python3 -m pytest analysis/test_app.py
"""

from __future__ import annotations

from app import resident_mb_in

# Trimmed from a real `/proc/self/status`, keeping the neighbours that make the
# parse non-trivial: `VmRSS` is not the first line, and three other keys start
# with the same four characters.
STATUS = """Name:\tpython3
State:\tS (sleeping)
VmPeak:\t  982416 kB
VmSize:\t  914880 kB
VmHWM:\t  187364 kB
VmRSS:\t  121244 kB
RssAnon:\t   93820 kB
Threads:\t6
"""


def test_reads_the_resident_line_and_not_a_neighbour():
    # 121244 kB, and the neighbours above and below it are both larger figures
    # that a looser match would take instead.
    assert resident_mb_in(STATUS) == 118.4


def test_says_nothing_for_a_body_without_the_line():
    # Every kernel that serves a `status` file in another shape. Absent is the
    # answer, and `/health` then omits the field rather than reporting a zero
    # that reads as a process using no memory.
    assert resident_mb_in("Name:\tpython3\nState:\tS (sleeping)\n") is None


def test_says_nothing_for_an_empty_body():
    assert resident_mb_in("") is None


def test_says_nothing_for_a_line_it_cannot_parse():
    # Belt and braces: the format is stable and this is what keeps a surprise in
    # it from throwing inside a health check, which is the one endpoint that has
    # to answer when everything else is broken.
    assert resident_mb_in("VmRSS:\tplenty\n") is None
    assert resident_mb_in("VmRSS:\n") is None
