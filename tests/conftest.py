"""Shared fixtures. Integration tests are skipped when ExifTool is absent."""

from __future__ import annotations

import base64
import shutil
from pathlib import Path

import pytest

# A valid 1x1 JPEG (baseline, with full Huffman tables) used as a scratch
# file for write/read round-trip tests.
_TINY_JPEG_B64 = (
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy"
    "MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEB"
    "AxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9"
    "AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6"
    "Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ip"
    "qrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIR"
    "AxEAPwD3+iiigD//2Q=="
)

requires_exiftool = pytest.mark.skipif(
    shutil.which("exiftool") is None,
    reason="exiftool is not installed",
)


@pytest.fixture
def jpeg_file(tmp_path: Path) -> Path:
    """A fresh scratch JPEG with no interesting metadata."""
    path = tmp_path / "photo.jpg"
    path.write_bytes(base64.b64decode(_TINY_JPEG_B64))
    return path
