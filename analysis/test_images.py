"""The two Dockerfiles that carry this service, held to each other.

The module list has been missed in one of them before, and the image built clean and crash-looped.
The list and the weights are named twice because a Dockerfile cannot read them from anywhere else,
so this is what stands in for one place.

    python3 -m pytest analysis/test_images.py
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

HERE = Path(__file__).parent
SIDECAR = HERE / "Dockerfile"
STATION = HERE.parent / "Dockerfile"

# The tests are not in the image, and neither is the harness.
NOT_SHIPPED = re.compile(r"^(test_.*|.*\.check)\.py$")

needs_both = pytest.mark.skipif(not STATION.exists(), reason="run with the repository root present")


def modules_in(dockerfile: Path) -> set[str]:
    named = re.findall(r"analysis/([\w.]+\.py)", "\n".join(line for line in dockerfile.read_text().splitlines() if line.startswith("COPY")))
    return set(named)


def weights_in(dockerfile: Path) -> tuple[str, str]:
    found = re.search(r"^ADD --checksum=(sha256:[0-9a-f]{64}) --chmod=644 (https://\S+\.ckpt) ", dockerfile.read_text(), re.MULTILINE)
    assert found is not None, f"{dockerfile} fetches no checkpoint against a hash"
    return found.group(1), found.group(2)


@needs_both
def test_both_images_carry_every_module_this_service_has() -> None:
    expected = {path.name for path in HERE.glob("*.py") if not NOT_SHIPPED.match(path.name)}

    assert modules_in(SIDECAR) == expected
    assert modules_in(STATION) == expected


@needs_both
def test_both_images_fetch_the_same_weights_against_the_same_hash() -> None:
    assert weights_in(SIDECAR) == weights_in(STATION)
