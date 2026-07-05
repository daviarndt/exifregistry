"""CLI-level tests using Typer's test runner."""

from pathlib import Path

from typer.testing import CliRunner

from exifkit.cli import app
from tests.conftest import requires_exiftool

runner = CliRunner()


def test_version_flag() -> None:
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == 0
    assert "exif-kit" in result.output


def test_gps_requires_coordinates(jpeg_file: Path) -> None:
    result = runner.invoke(app, ["gps", str(jpeg_file)])
    assert result.exit_code == 1


def test_date_requires_an_action(jpeg_file: Path) -> None:
    result = runner.invoke(app, ["date", str(jpeg_file)])
    assert result.exit_code == 1


def test_show_missing_file_fails() -> None:
    result = runner.invoke(app, ["show", "does-not-exist.jpg"])
    assert result.exit_code == 1


@requires_exiftool
def test_gps_then_show_json(jpeg_file: Path) -> None:
    result = runner.invoke(
        app, ["gps", str(jpeg_file), "--coords", "-23.5505, -46.6333", "--no-backup"]
    )
    assert result.exit_code == 0, result.output

    result = runner.invoke(app, ["show", str(jpeg_file), "--json"])
    assert result.exit_code == 0
    assert "-23.5505" in result.output


@requires_exiftool
def test_date_taken_and_summary(jpeg_file: Path) -> None:
    result = runner.invoke(
        app, ["date", str(jpeg_file), "--taken", "2024-06-01 14:30", "--no-backup"]
    )
    assert result.exit_code == 0, result.output

    result = runner.invoke(app, ["show", str(jpeg_file)])
    assert result.exit_code == 0
    assert "2024:06:01 14:30:00" in result.output


@requires_exiftool
def test_strip_with_yes(jpeg_file: Path) -> None:
    result = runner.invoke(
        app, ["date", str(jpeg_file), "--taken", "2024-06-01", "--no-backup"]
    )
    assert result.exit_code == 0
    result = runner.invoke(app, ["strip", str(jpeg_file), "--yes", "--no-backup"])
    assert result.exit_code == 0, result.output

    result = runner.invoke(app, ["show", str(jpeg_file), "--json"])
    assert "DateTimeOriginal" not in result.output


@requires_exiftool
def test_doctor() -> None:
    result = runner.invoke(app, ["doctor"])
    assert result.exit_code == 0
    assert "ExifTool" in result.output
