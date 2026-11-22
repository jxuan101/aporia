import pytest

from app.core.errors import ApiError
from app.core.validation import capture_body, capture_text, search_query


def test_capture_body_preserves_original_whitespace() -> None:
    assert capture_body({"text": "  remember this  "}) == "  remember this  "


@pytest.mark.parametrize("value", ["", "  \n", "x" * 10_001, 12, None])
def test_capture_text_rejects_empty_oversized_and_non_text_values(
    value: object,
) -> None:
    with pytest.raises(ApiError) as error:
        capture_text(value)

    assert error.value.status_code == 400


def test_capture_body_rejects_unexpected_fields() -> None:
    with pytest.raises(ApiError, match="10,000 characters"):
        capture_body({"text": "thought", "user_id": "untrusted"})


def test_search_query_trims_and_bounds_input() -> None:
    assert search_query("  book  ") == "book"
    assert search_query(None) is None
    assert search_query("") is None

    with pytest.raises(ApiError, match="Search must"):
        search_query("   ")
    with pytest.raises(ApiError, match="Search must"):
        search_query("x" * 201)
