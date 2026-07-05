"""Integration tests: real ExifTool round-trips on a scratch JPEG."""

from pathlib import Path

from exifkit import engine, fields
from tests.conftest import requires_exiftool


@requires_exiftool
class TestRoundTrips:
    def test_write_and_read_gps(self, jpeg_file: Path) -> None:
        engine.write(
            [jpeg_file], fields.gps_tags(-23.5505, -46.6333, altitude=760.0), backup=False
        )
        metadata = engine.read([jpeg_file])[0]
        assert metadata["GPSLatitude"] == -23.5505
        assert metadata["GPSLongitude"] == -46.6333
        assert metadata["GPSAltitude"] == 760.0

    def test_remove_gps(self, jpeg_file: Path) -> None:
        engine.write([jpeg_file], fields.gps_tags(10.0, 20.0), backup=False)
        engine.write([jpeg_file], fields.gps_remove_tags(), backup=False)
        metadata = engine.read([jpeg_file])[0]
        assert "GPSLatitude" not in metadata

    def test_write_and_read_capture_date(self, jpeg_file: Path) -> None:
        engine.write(
            [jpeg_file], fields.capture_date_tags("2024:06:01 14:30:00"), backup=False
        )
        metadata = engine.read([jpeg_file])[0]
        assert metadata["DateTimeOriginal"] == "2024:06:01 14:30:00"
        assert metadata["CreateDate"] == "2024:06:01 14:30:00"

    def test_shift_dates(self, jpeg_file: Path) -> None:
        engine.write(
            [jpeg_file], fields.capture_date_tags("2024:06:01 14:30:00"), backup=False
        )
        operator, amount = fields.parse_shift("+2h")
        engine.write([jpeg_file], fields.shift_tags(operator, amount), backup=False)
        metadata = engine.read([jpeg_file])[0]
        assert metadata["DateTimeOriginal"] == "2024:06:01 16:30:00"

    def test_backup_creates_original_copy(self, jpeg_file: Path) -> None:
        engine.write([jpeg_file], fields.capture_date_tags("2024:06:01 14:30:00"))
        backup_file = jpeg_file.with_name(jpeg_file.name + "_original")
        assert backup_file.exists()

    def test_copy_metadata(self, jpeg_file: Path, tmp_path: Path) -> None:
        target = tmp_path / "copy.jpg"
        target.write_bytes(jpeg_file.read_bytes())
        engine.write(
            [jpeg_file], fields.capture_date_tags("2024:06:01 14:30:00"), backup=False
        )
        engine.copy_metadata(jpeg_file, [target], backup=False)
        metadata = engine.read([target])[0]
        assert metadata["DateTimeOriginal"] == "2024:06:01 14:30:00"

    def test_strip_metadata(self, jpeg_file: Path) -> None:
        engine.write([jpeg_file], fields.gps_tags(10.0, 20.0), backup=False)
        engine.strip_metadata([jpeg_file], backup=False)
        metadata = engine.read([jpeg_file])[0]
        assert "GPSLatitude" not in metadata
        assert "DateTimeOriginal" not in metadata
