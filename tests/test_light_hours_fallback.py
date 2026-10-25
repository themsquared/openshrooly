from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / "esphome/scripts/lighting_control_manager.yaml").read_text()


def test_nan_hours_write_back_is_not_skipped():
    # fabsf(NaN - 12) > 0.01 is false, so NaN needs its own check.
    assert "!std::isfinite(raw_hours) || fabsf(raw_hours - 12.0f) > 0.01f" in SCRIPT


def test_write_back_is_capped_so_the_queued_script_cannot_loop():
    assert "hours_fix_attempts < 3" in SCRIPT
    assert "hours_fix_attempts = 0;" in SCRIPT
