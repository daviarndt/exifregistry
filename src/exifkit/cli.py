"""Command-line interface for exif-kit.

Running ``exifkit`` with no arguments opens the interactive guided mode;
subcommands offer the same operations for direct/scripted use.
"""

from __future__ import annotations

import json as json_module
from pathlib import Path
from typing import Optional

import typer

from . import __version__, engine, fields
from .display import (
    console,
    describe_files,
    print_all_tags,
    print_error,
    print_success,
    print_summary,
)
from .paths import expand_paths

app = typer.Typer(
    name="exifkit",
    help="Inspect and edit photo/video metadata (EXIF, GPS, dates).",
    invoke_without_command=True,
    no_args_is_help=False,
    add_completion=False,
)

BackupOption = typer.Option(
    True,
    "--backup/--no-backup",
    help="Keep an untouched copy next to each edited file ('_original' suffix).",
)


def _fail(message: str) -> None:
    print_error(str(message))
    raise typer.Exit(code=1)


def _resolve(files: list[str], recursive: bool = False) -> list[Path]:
    try:
        paths = expand_paths(files, recursive=recursive)
    except FileNotFoundError as exc:
        _fail(str(exc))
    if not paths:
        _fail("No supported photo or video files found.")
    return paths


def _write(paths: list[Path], tag_args: list[str], backup: bool) -> None:
    try:
        engine.write(paths, tag_args, backup=backup)
    except engine.ExifToolError as exc:
        _fail(str(exc))


@app.callback()
def main(
    ctx: typer.Context,
    version: bool = typer.Option(
        False, "--version", "-V", help="Show the exif-kit version and exit."
    ),
) -> None:
    if version:
        console.print(f"exif-kit {__version__}")
        raise typer.Exit()
    if ctx.invoked_subcommand is None:
        from .interactive import run_interactive

        run_interactive()


@app.command()
def show(
    files: list[str] = typer.Argument(..., help="Files, folders or glob patterns."),
    all_tags: bool = typer.Option(
        False, "--all", "-a", help="Show every tag instead of the curated summary."
    ),
    as_json: bool = typer.Option(
        False, "--json", help="Output raw JSON (machine-readable)."
    ),
    recursive: bool = typer.Option(
        False, "--recursive", "-r", help="Recurse into subfolders."
    ),
) -> None:
    """Show metadata for one or more files."""
    paths = _resolve(files, recursive)
    try:
        metadata = engine.read(paths)
    except engine.ExifToolError as exc:
        _fail(str(exc))
    if as_json:
        console.print_json(json_module.dumps(metadata, default=str))
        return
    for item in metadata:
        if all_tags:
            print_all_tags(item)
        else:
            print_summary(item)


@app.command()
def gps(
    files: list[str] = typer.Argument(..., help="Files, folders or glob patterns."),
    lat: Optional[float] = typer.Option(None, "--lat", help="Latitude in decimal degrees."),
    lon: Optional[float] = typer.Option(None, "--lon", help="Longitude in decimal degrees."),
    coords: Optional[str] = typer.Option(
        None,
        "--coords",
        "-c",
        help='Coordinates pasted from a maps app, e.g. "-23.5505, -46.6333".',
    ),
    altitude: Optional[float] = typer.Option(None, "--alt", help="Altitude in meters."),
    remove: bool = typer.Option(False, "--remove", help="Delete all GPS data instead."),
    backup: bool = BackupOption,
) -> None:
    """Set (or remove) the GPS location of photos and videos."""
    paths = _resolve(files)

    if remove:
        if lat is not None or lon is not None or coords:
            _fail("--remove cannot be combined with coordinates.")
    else:
        if coords:
            if lat is not None or lon is not None:
                _fail("Use either --coords or --lat/--lon, not both.")
            try:
                lat, lon = fields.parse_coordinates(coords)
            except ValueError as exc:
                _fail(str(exc))
        if lat is None or lon is None:
            _fail('Provide a location with --coords "lat, lon" (or --lat and --lon).')
        try:
            fields.validate_coordinates(lat, lon)
        except ValueError as exc:
            _fail(str(exc))

    # Videos (QuickTime containers) use a different location tag, so write
    # images and videos in separate passes.
    images = [p for p in paths if not fields.is_video(p)]
    videos = [p for p in paths if fields.is_video(p)]
    for group, video in ((images, False), (videos, True)):
        if not group:
            continue
        if remove:
            tag_args = fields.gps_remove_tags(video=video)
        else:
            tag_args = fields.gps_tags(lat, lon, altitude, video=video)  # type: ignore[arg-type]
        _write(group, tag_args, backup)

    if remove:
        print_success(f"Removed GPS data from {describe_files(paths)}.")
    else:
        print_success(f"Set GPS of {describe_files(paths)} to {lat}, {lon}.")


@app.command()
def date(
    files: list[str] = typer.Argument(..., help="Files, folders or glob patterns."),
    taken: Optional[str] = typer.Option(
        None, "--taken", "-t", help='Capture date, e.g. "2024-06-01 14:30".'
    ),
    modified: Optional[str] = typer.Option(
        None, "--modified", "-m", help="Metadata modification date (ModifyDate)."
    ),
    all_dates: Optional[str] = typer.Option(
        None, "--all", help="Set taken, created and modified dates at once."
    ),
    shift: Optional[str] = typer.Option(
        None,
        "--shift",
        "-s",
        help='Shift all dates, e.g. "+2h", "-30m", "+1d 2h30m" (timezone fixes).',
    ),
    sync_file: bool = typer.Option(
        False,
        "--sync-file",
        help="Also set the file's modification date to match the capture date.",
    ),
    backup: bool = BackupOption,
) -> None:
    """Edit capture/modification dates, or shift them to fix timezones."""
    paths = _resolve(files)

    tag_args: list[str] = []
    try:
        if all_dates and (taken or modified):
            _fail("--all already covers --taken and --modified; use one or the other.")
        if taken:
            tag_args += fields.capture_date_tags(fields.parse_datetime(taken))
        if modified:
            tag_args += fields.modify_date_tags(fields.parse_datetime(modified))
        if all_dates:
            tag_args += fields.all_dates_tags(fields.parse_datetime(all_dates))
        if shift:
            if taken or modified or all_dates:
                _fail("--shift cannot be combined with absolute dates.")
            operator, amount = fields.parse_shift(shift)
            tag_args += fields.shift_tags(operator, amount)
    except ValueError as exc:
        _fail(str(exc))

    if sync_file:
        tag_args += fields.sync_file_date_tags()

    if not tag_args:
        _fail("Nothing to do. Use --taken, --modified, --all, --shift or --sync-file.")

    _write(paths, tag_args, backup)
    print_success(f"Updated dates on {describe_files(paths)}.")


@app.command()
def copy(
    source: str = typer.Argument(..., help="File to copy metadata from."),
    targets: list[str] = typer.Argument(..., help="Files to copy metadata onto."),
    backup: bool = BackupOption,
) -> None:
    """Copy all metadata from one file onto others (e.g. after export)."""
    source_path = Path(source).expanduser()
    if not source_path.is_file():
        _fail(f"Source file not found: {source}")
    target_paths = _resolve(targets)
    try:
        engine.copy_metadata(source_path, target_paths, backup=backup)
    except engine.ExifToolError as exc:
        _fail(str(exc))
    print_success(
        f"Copied metadata from {source_path.name} to {describe_files(target_paths)}."
    )


@app.command()
def strip(
    files: list[str] = typer.Argument(..., help="Files, folders or glob patterns."),
    yes: bool = typer.Option(
        False, "--yes", "-y", help="Skip the confirmation prompt."
    ),
    backup: bool = BackupOption,
) -> None:
    """Remove ALL metadata (camera, dates, GPS) — for privacy-safe sharing."""
    paths = _resolve(files)
    if not yes:
        confirmed = typer.confirm(
            f"Remove all metadata from {describe_files(paths)}?"
        )
        if not confirmed:
            raise typer.Exit()
    try:
        engine.strip_metadata(paths, backup=backup)
    except engine.ExifToolError as exc:
        _fail(str(exc))
    print_success(f"Stripped all metadata from {describe_files(paths)}.")


@app.command()
def doctor() -> None:
    """Check that exif-kit's dependencies are healthy."""
    console.print(f"[bold]exif-kit[/bold] {__version__}")
    try:
        exe = engine.find_exiftool()
        version = engine.exiftool_version()
        print_success(f"ExifTool {version} found at {exe}")
    except engine.ExifToolNotFound:
        print_error("ExifTool is not installed.\n" + engine.INSTALL_HINT)
        raise typer.Exit(code=1)
    console.print("[green]Everything looks good.[/green]")


if __name__ == "__main__":
    app()
