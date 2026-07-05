"""Unit tests for the pure parsing/tag-building helpers (no ExifTool needed)."""

import pytest

from exifkit import fields


class TestParseDatetime:
    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("2024-06-01 14:30", "2024:06:01 14:30:00"),
            ("2024-06-01 14:30:45", "2024:06:01 14:30:45"),
            ("2024-06-01T14:30", "2024:06:01 14:30:00"),
            ("2024-06-01", "2024:06:01 00:00:00"),
            ("2024:06:01 14:30:00", "2024:06:01 14:30:00"),
            ("01/06/2024 14:30", "2024:06:01 14:30:00"),
            ("01/06/2024", "2024:06:01 00:00:00"),
        ],
    )
    def test_accepted_formats(self, text: str, expected: str) -> None:
        assert fields.parse_datetime(text) == expected

    @pytest.mark.parametrize("text", ["yesterday", "2024-13-01", "junk", ""])
    def test_rejected_formats(self, text: str) -> None:
        with pytest.raises(ValueError):
            fields.parse_datetime(text)


class TestParseShift:
    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("+2h", ("+=", "0:0:0 2:0:0")),
            ("-30m", ("-=", "0:0:0 0:30:0")),
            ("+1d 2h30m", ("+=", "0:0:1 2:30:0")),
            ("2h", ("+=", "0:0:0 2:0:0")),  # sign defaults to +
            ("+1y2mo3d", ("+=", "1:2:3 0:0:0")),
            ("-45s", ("-=", "0:0:0 0:0:45")),
        ],
    )
    def test_accepted_shifts(self, text: str, expected: tuple) -> None:
        assert fields.parse_shift(text) == expected

    @pytest.mark.parametrize("text", ["", "+", "2 hours", "abc", "+2x"])
    def test_rejected_shifts(self, text: str) -> None:
        with pytest.raises(ValueError):
            fields.parse_shift(text)


class TestParseCoordinates:
    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("-23.5505, -46.6333", (-23.5505, -46.6333)),
            ("-23.5505,-46.6333", (-23.5505, -46.6333)),
            ("40.7128 -74.006", (40.7128, -74.006)),
        ],
    )
    def test_accepted(self, text: str, expected: tuple) -> None:
        assert fields.parse_coordinates(text) == expected

    @pytest.mark.parametrize("text", ["", "12.3", "a, b", "91, 0", "0, 181"])
    def test_rejected(self, text: str) -> None:
        with pytest.raises(ValueError):
            fields.parse_coordinates(text)


class TestGpsTags:
    def test_southern_western_hemisphere(self) -> None:
        tags = fields.gps_tags(-23.5505, -46.6333)
        assert "-GPSLatitude=23.5505" in tags
        assert "-GPSLatitudeRef=S" in tags
        assert "-GPSLongitude=46.6333" in tags
        assert "-GPSLongitudeRef=W" in tags

    def test_northern_eastern_hemisphere_with_altitude(self) -> None:
        tags = fields.gps_tags(48.8566, 2.3522, altitude=35.0)
        assert "-GPSLatitudeRef=N" in tags
        assert "-GPSLongitudeRef=E" in tags
        assert "-GPSAltitude=35.0" in tags
        assert "-GPSAltitudeRef=Above Sea Level" in tags

    def test_video_gets_quicktime_tag(self) -> None:
        tags = fields.gps_tags(-23.5505, -46.6333, video=True)
        assert "-GPSCoordinates=-23.5505, -46.6333" in tags

    def test_out_of_range_rejected(self) -> None:
        with pytest.raises(ValueError):
            fields.gps_tags(95.0, 0.0)


class TestDateTags:
    def test_capture_date_sets_original_and_create(self) -> None:
        tags = fields.capture_date_tags("2024:06:01 14:30:00")
        assert tags == [
            "-DateTimeOriginal=2024:06:01 14:30:00",
            "-CreateDate=2024:06:01 14:30:00",
        ]

    def test_shift_tags(self) -> None:
        assert fields.shift_tags("+=", "0:0:0 2:0:0") == ["-AllDates+=0:0:0 2:0:0"]


class TestIsVideo:
    @pytest.mark.parametrize(
        ("name", "expected"),
        [("clip.MP4", True), ("clip.mov", True), ("photo.CR3", False), ("a.jpg", False)],
    )
    def test_detection(self, name: str, expected: bool) -> None:
        assert fields.is_video(name) is expected
