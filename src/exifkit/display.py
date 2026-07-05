"""Rendering of metadata for the terminal using rich."""

from __future__ import annotations

from fractions import Fraction
from pathlib import Path

from rich.console import Console
from rich.table import Table

console = Console()
error_console = Console(stderr=True, style="bold red")


def _format_exposure(value: object) -> str:
    try:
        seconds = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return str(value)
    if seconds >= 1:
        return f"{seconds:g}s"
    fraction = Fraction(seconds).limit_denominator(8000)
    return f"1/{round(fraction.denominator / fraction.numerator)}s"


def _format_gps(metadata: dict) -> str | None:
    lat = metadata.get("GPSLatitude")
    lon = metadata.get("GPSLongitude")
    if lat is None or lon is None:
        coords = metadata.get("GPSCoordinates")  # QuickTime videos
        return str(coords) if coords else None
    text = f"{float(lat):.6f}, {float(lon):.6f}"
    altitude = metadata.get("GPSAltitude")
    if altitude is not None:
        text += f"  (altitude {float(altitude):.1f}m)"
    return text


def _format_size(value: object) -> str:
    try:
        size = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return str(value)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024 or unit == "TB":
            return f"{size:.1f} {unit}" if unit != "B" else f"{int(size)} B"
        size /= 1024
    return str(value)


def _format_duration(value: object) -> str:
    try:
        total = round(float(value))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return str(value)
    minutes, seconds = divmod(total, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}h {minutes:02d}m {seconds:02d}s"
    return f"{minutes}m {seconds:02d}s"


def summary_rows(metadata: dict) -> list[tuple[str, str]]:
    """Build (label, value) rows for the curated summary view."""
    rows: list[tuple[str, str]] = []

    def add(label: str, value: object | None) -> None:
        if value not in (None, "", 0):
            rows.append((label, str(value)))

    add("File", metadata.get("FileName"))
    add("Type", metadata.get("FileType"))
    if metadata.get("FileSize") is not None:
        add("Size", _format_size(metadata["FileSize"]))
    width, height = metadata.get("ImageWidth"), metadata.get("ImageHeight")
    if width and height:
        add("Dimensions", f"{width} x {height}")

    make, model = metadata.get("Make"), metadata.get("Model")
    camera = " ".join(str(p) for p in (make, model) if p)
    add("Camera", camera or None)
    add("Lens", metadata.get("LensModel") or metadata.get("LensID"))

    if metadata.get("ISO") is not None:
        add("ISO", metadata.get("ISO"))
    if metadata.get("FNumber") is not None:
        add("Aperture", f"f/{metadata['FNumber']:g}")
    if metadata.get("ExposureTime") is not None:
        add("Shutter", _format_exposure(metadata["ExposureTime"]))
    if metadata.get("FocalLength") is not None:
        add("Focal length", f"{metadata['FocalLength']:g}mm")

    add("Taken (DateTimeOriginal)", metadata.get("DateTimeOriginal"))
    add("Created (CreateDate)", metadata.get("CreateDate"))
    add("Modified (ModifyDate)", metadata.get("ModifyDate"))
    add("File modified", metadata.get("FileModifyDate"))

    if metadata.get("Duration") is not None:
        add("Duration", _format_duration(metadata["Duration"]))

    gps = _format_gps(metadata)
    add("GPS", gps or "— none —")
    return rows


def print_summary(metadata: dict) -> None:
    table = Table(
        title=metadata.get("FileName", ""),
        show_header=False,
        title_style="bold cyan",
        border_style="dim",
    )
    table.add_column("Field", style="bold", no_wrap=True)
    table.add_column("Value")
    for label, value in summary_rows(metadata):
        table.add_row(label, value)
    console.print(table)


def print_all_tags(metadata: dict) -> None:
    table = Table(
        title=metadata.get("FileName", ""),
        title_style="bold cyan",
        border_style="dim",
    )
    table.add_column("Tag", style="bold", no_wrap=True)
    table.add_column("Value", overflow="fold")
    for key in sorted(metadata):
        if key == "SourceFile":
            continue
        table.add_row(key, str(metadata[key]))
    console.print(table)


def print_success(message: str) -> None:
    console.print(f"[bold green]✓[/bold green] {message}")


def print_error(message: str) -> None:
    error_console.print(message)


def describe_files(paths: list[Path]) -> str:
    if len(paths) == 1:
        return paths[0].name
    return f"{len(paths)} files"
