"""Guided interactive mode — what you get when running ``exifkit`` bare.

Walks the user through each operation with menus and prompts, so no flags
need to be memorized. Every action maps 1:1 onto a CLI subcommand.
"""

from __future__ import annotations

from pathlib import Path

import questionary
from questionary import Choice

from . import engine, fields
from .display import (
    console,
    describe_files,
    print_error,
    print_success,
    print_summary,
)
from .paths import expand_paths

STYLE = questionary.Style(
    [
        ("qmark", "fg:cyan bold"),
        ("question", "bold"),
        ("pointer", "fg:cyan bold"),
        ("highlighted", "fg:cyan bold"),
        ("answer", "fg:green"),
    ]
)


def _ask_files() -> list[Path] | None:
    while True:
        answer = questionary.path(
            "Which file(s)? (path, folder, or glob like *.jpg)",
            style=STYLE,
        ).ask()
        if answer is None or not answer.strip():
            return None
        try:
            paths = expand_paths([answer.strip()])
        except FileNotFoundError as exc:
            print_error(str(exc))
            continue
        if not paths:
            print_error("No supported photo or video files found there.")
            continue
        console.print(f"[dim]Selected {describe_files(paths)}.[/dim]")
        return paths


def _ask_backup() -> bool:
    return questionary.confirm(
        "Keep a backup copy of the original file(s)?",
        default=True,
        style=STYLE,
    ).ask()


def _write_grouped_gps(
    paths: list[Path],
    backup: bool,
    remove: bool = False,
    lat: float | None = None,
    lon: float | None = None,
    altitude: float | None = None,
) -> None:
    images = [p for p in paths if not fields.is_video(p)]
    videos = [p for p in paths if fields.is_video(p)]
    for group, video in ((images, False), (videos, True)):
        if not group:
            continue
        if remove:
            tag_args = fields.gps_remove_tags(video=video)
        else:
            tag_args = fields.gps_tags(lat, lon, altitude, video=video)  # type: ignore[arg-type]
        engine.write(group, tag_args, backup=backup)


def _action_inspect() -> None:
    paths = _ask_files()
    if not paths:
        return
    for item in engine.read(paths):
        print_summary(item)


def _action_gps() -> None:
    paths = _ask_files()
    if not paths:
        return
    coords_text = questionary.text(
        'Coordinates (paste from a maps app, "lat, lon"):',
        style=STYLE,
    ).ask()
    if not coords_text:
        return
    try:
        lat, lon = fields.parse_coordinates(coords_text)
    except ValueError as exc:
        print_error(str(exc))
        return
    alt_text = questionary.text(
        "Altitude in meters (optional, Enter to skip):",
        style=STYLE,
    ).ask()
    altitude = None
    if alt_text and alt_text.strip():
        try:
            altitude = float(alt_text.strip())
        except ValueError:
            print_error("Altitude must be a number — skipping it.")
    backup = _ask_backup()
    _write_grouped_gps(paths, backup, lat=lat, lon=lon, altitude=altitude)
    print_success(f"Set GPS of {describe_files(paths)} to {lat}, {lon}.")


def _action_gps_remove() -> None:
    paths = _ask_files()
    if not paths:
        return
    if not questionary.confirm(
        f"Remove all GPS data from {describe_files(paths)}?",
        default=False,
        style=STYLE,
    ).ask():
        return
    backup = _ask_backup()
    _write_grouped_gps(paths, backup, remove=True)
    print_success(f"Removed GPS data from {describe_files(paths)}.")


def _action_dates() -> None:
    paths = _ask_files()
    if not paths:
        return
    mode = questionary.select(
        "What do you want to change?",
        choices=[
            Choice("Capture date (when the photo was taken)", "taken"),
            Choice("Modification date (when it was edited)", "modified"),
            Choice("All dates at once", "all"),
            Choice("Shift all dates (fix a wrong timezone/clock)", "shift"),
            Choice("Back", "back"),
        ],
        style=STYLE,
    ).ask()
    if mode in (None, "back"):
        return

    tag_args: list[str] = []
    try:
        if mode == "shift":
            shift_text = questionary.text(
                'Shift amount (e.g. "+2h", "-30m", "+1d 2h30m"):',
                style=STYLE,
            ).ask()
            if not shift_text:
                return
            operator, amount = fields.parse_shift(shift_text)
            tag_args = fields.shift_tags(operator, amount)
        else:
            date_text = questionary.text(
                'New date (e.g. "2024-06-01 14:30"):',
                style=STYLE,
            ).ask()
            if not date_text:
                return
            exif_dt = fields.parse_datetime(date_text)
            if mode == "taken":
                tag_args = fields.capture_date_tags(exif_dt)
            elif mode == "modified":
                tag_args = fields.modify_date_tags(exif_dt)
            else:
                tag_args = fields.all_dates_tags(exif_dt)
    except ValueError as exc:
        print_error(str(exc))
        return

    if mode in ("taken", "all") and questionary.confirm(
        "Also set the file's modification date to match?",
        default=False,
        style=STYLE,
    ).ask():
        tag_args += fields.sync_file_date_tags()

    backup = _ask_backup()
    engine.write(paths, tag_args, backup=backup)
    print_success(f"Updated dates on {describe_files(paths)}.")


def _action_copy() -> None:
    source = questionary.path("Copy metadata FROM which file?", style=STYLE).ask()
    if not source:
        return
    source_path = Path(source.strip()).expanduser()
    if not source_path.is_file():
        print_error(f"Source file not found: {source}")
        return
    targets = _ask_files()
    if not targets:
        return
    backup = _ask_backup()
    engine.copy_metadata(source_path, targets, backup=backup)
    print_success(
        f"Copied metadata from {source_path.name} to {describe_files(targets)}."
    )


def _action_strip() -> None:
    paths = _ask_files()
    if not paths:
        return
    if not questionary.confirm(
        f"Remove ALL metadata from {describe_files(paths)}? This includes "
        "camera info, dates and GPS.",
        default=False,
        style=STYLE,
    ).ask():
        return
    backup = _ask_backup()
    engine.strip_metadata(paths, backup=backup)
    print_success(f"Stripped all metadata from {describe_files(paths)}.")


ACTIONS = [
    Choice("📷  Inspect metadata", _action_inspect),
    Choice("📍  Set GPS location", _action_gps),
    Choice("🚫  Remove GPS location", _action_gps_remove),
    Choice("🕑  Edit dates", _action_dates),
    Choice("📋  Copy metadata between files", _action_copy),
    Choice("🧹  Strip all metadata (privacy)", _action_strip),
    Choice("👋  Quit", None),
]


def run_interactive() -> None:
    try:
        engine.find_exiftool()
    except engine.ExifToolNotFound as exc:
        print_error(str(exc))
        raise SystemExit(1)

    console.print("[bold cyan]exif-kit[/bold cyan] — photo & video metadata toolkit")
    console.print("[dim]Ctrl+C or 'Quit' to leave at any time.[/dim]\n")

    while True:
        try:
            action = questionary.select(
                "What would you like to do?",
                choices=ACTIONS,
                style=STYLE,
            ).ask()
            if action is None:
                break
            action()
            console.print()
        except KeyboardInterrupt:
            break
        except engine.ExifToolError as exc:
            print_error(str(exc))
    console.print("[dim]Bye![/dim]")
