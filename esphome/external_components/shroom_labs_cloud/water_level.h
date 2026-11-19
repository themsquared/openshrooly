#pragma once

// Tank water state from the capacitive level reading. Pure C++ (no ESPHome types) so a host test
// can run it. One instance lives in the water level script and is fed every 30 s reading.
//
//   level is a percent of the tank (0 to 110), or NaN when the sensor could not be read.
//   Ok     at or above the low exit mark, or never below the low enter mark
//   Low    below 30, stays Low until 35
//   Empty  below 12, stays Empty until 18. The humidifier must not run.
//   Unknown no readable level yet, or none for 10 minutes. Unknown never blocks the humidifier,
//          so a dead sensor cannot stop a healthy chamber.
//
// A change of state needs 3 reads in a row that agree (90 s at one read per 30 s), so ripples and
// one bad read do not flip it. An unreadable level does not count as a read in either direction.

#include <cmath>
#include <cstdint>

namespace esphome {
namespace shroom_labs {

enum class WaterState : uint8_t { Unknown = 0, Ok = 1, Low = 2, Empty = 3 };

inline const char *water_state_name(WaterState s) {
  switch (s) {
    case WaterState::Ok:
      return "ok";
    case WaterState::Low:
      return "low";
    case WaterState::Empty:
      return "empty";
    default:
      return "unknown";
  }
}

struct WaterThresholds {
  float low_enter{30.0f};
  float low_exit{35.0f};
  float empty_enter{12.0f};
  float empty_exit{18.0f};
  uint8_t debounce{3};
  uint32_t unknown_after_ms{10u * 60u * 1000u};
};

class WaterTracker {
 public:
  explicit WaterTracker(WaterThresholds t = WaterThresholds{}) : t_(t) {}

  // Feed one reading. Returns true when the committed state changed.
  bool update(float level, uint32_t now_ms) {
    if (std::isnan(level)) {
      if (state_ != WaterState::Unknown && have_valid_ &&
          static_cast<uint32_t>(now_ms - last_valid_ms_) >= t_.unknown_after_ms) {
        return commit_(WaterState::Unknown);
      }
      return false;
    }
    have_valid_ = true;
    last_valid_ms_ = now_ms;
    level_ = level;
    const WaterState want = target_(level);
    if (want == state_) {
      pending_ = state_;
      pending_n_ = 0;
      return false;
    }
    if (want == pending_) {
      if (pending_n_ < 255)
        pending_n_++;
    } else {
      pending_ = want;
      pending_n_ = 1;
    }
    if (pending_n_ >= t_.debounce)
      return commit_(want);
    return false;
  }

  // Forget everything, for example after the dry baselines are recalibrated.
  void reset() { *this = WaterTracker(t_); }

  WaterState state() const { return state_; }
  bool empty() const { return state_ == WaterState::Empty; }
  // True when the owner should be told: low, empty. Unknown and Ok are not alerts.
  bool needs_water() const { return state_ == WaterState::Low || state_ == WaterState::Empty; }
  float level() const { return level_; }

 private:
  WaterState target_(float level) const {
    if (level < t_.empty_enter)
      return WaterState::Empty;
    if (state_ == WaterState::Empty && level < t_.empty_exit)
      return WaterState::Empty;
    if (level < t_.low_enter)
      return WaterState::Low;
    if ((state_ == WaterState::Low || state_ == WaterState::Empty) && level < t_.low_exit)
      return WaterState::Low;
    return WaterState::Ok;
  }

  bool commit_(WaterState s) {
    const bool changed = s != state_;
    state_ = s;
    pending_ = s;
    pending_n_ = 0;
    return changed;
  }

  WaterThresholds t_;
  WaterState state_{WaterState::Unknown};
  WaterState pending_{WaterState::Unknown};
  uint8_t pending_n_{0};
  bool have_valid_{false};
  uint32_t last_valid_ms_{0};
  float level_{NAN};
};

}  // namespace shroom_labs
}  // namespace esphome
