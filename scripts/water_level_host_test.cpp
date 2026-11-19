// Host test for the tank water state machine. Build and run: scripts/test_water_level.py
#include "cloud_format.h"
#include "water_level.h"

#include <cmath>
#include <cstdio>
#include <string_view>

using namespace esphome::shroom_labs;

static int fails = 0;
static void expect(bool ok, const char *name) {
  if (!ok) {
    std::fprintf(stderr, "FAIL %s\n", name);
    fails++;
  } else {
    std::printf("ok %s\n", name);
  }
}

// Feed `n` reads of `level`, 30 s apart, from `*t`. Returns the number of state changes.
static int feed(WaterTracker &w, float level, int n, uint32_t *t) {
  int changes = 0;
  for (int i = 0; i < n; i++) {
    *t += 30000;
    if (w.update(level, *t))
      changes++;
  }
  return changes;
}

int main() {
  uint32_t t = 1000;
  {
    WaterTracker w;
    expect(w.state() == WaterState::Unknown, "starts unknown");
    expect(feed(w, 80, 2, &t) == 0 && w.state() == WaterState::Unknown, "two reads are not enough");
    expect(feed(w, 80, 1, &t) == 1 && w.state() == WaterState::Ok, "three reads commit ok");
    expect(!w.needs_water() && !w.empty(), "ok needs nothing");
  }
  {
    WaterTracker w;
    feed(w, 80, 3, &t);
    feed(w, 29, 2, &t);
    expect(w.state() == WaterState::Ok, "two low reads do not flip");
    feed(w, 60, 1, &t);
    feed(w, 29, 2, &t);
    expect(w.state() == WaterState::Ok, "a good read resets the count");
    feed(w, 29, 1, &t);
    expect(w.state() == WaterState::Low && w.needs_water() && !w.empty(), "three low reads commit low");
    feed(w, 34, 5, &t);
    expect(w.state() == WaterState::Low, "34 is inside the hysteresis band, stays low");
    feed(w, 35, 3, &t);
    expect(w.state() == WaterState::Ok, "35 clears low");
  }
  {
    WaterTracker w;
    feed(w, 80, 3, &t);
    feed(w, 11, 3, &t);
    expect(w.state() == WaterState::Empty && w.empty() && w.needs_water(), "below 12 is empty");
    feed(w, 12, 5, &t);
    expect(w.state() == WaterState::Empty, "12 is not enough to leave empty");
    feed(w, 17, 5, &t);
    expect(w.state() == WaterState::Empty, "17 still empty");
    feed(w, 18, 3, &t);
    expect(w.state() == WaterState::Low, "18 leaves empty into low");
    feed(w, 34, 5, &t);
    expect(w.state() == WaterState::Low, "still low until 35");
    feed(w, 36, 3, &t);
    expect(w.state() == WaterState::Ok, "refilled");
  }
  {
    WaterTracker w;
    feed(w, 80, 3, &t);
    feed(w, 5, 3, &t);
    expect(w.empty(), "straight to empty");
    feed(w, 90, 3, &t);
    expect(w.state() == WaterState::Ok, "empty to ok in one refill");
  }
  {
    WaterTracker w;
    feed(w, 11, 3, &t);
    expect(w.state() == WaterState::Empty, "can start empty");
  }
  {
    // An unreadable sensor never reads as empty, and never blocks the humidifier.
    WaterTracker w;
    feed(w, 5, 3, &t);
    expect(w.empty(), "empty before the sensor fails");
    for (int i = 0; i < 10; i++) {
      t += 30000;
      w.update(NAN, t);
    }
    expect(w.empty(), "5 minutes unreadable keeps the last state");
    for (int i = 0; i < 12; i++) {
      t += 30000;
      w.update(NAN, t);
    }
    expect(w.state() == WaterState::Unknown && !w.empty() && !w.needs_water(), "10 minutes unreadable is unknown, not empty");
    feed(w, 80, 3, &t);
    expect(w.state() == WaterState::Ok, "recovers when readable again");
  }
  {
    WaterTracker w;
    feed(w, 80, 3, &t);
    feed(w, 29, 2, &t);
    t += 30000;
    w.update(NAN, t);
    feed(w, 29, 1, &t);
    expect(w.state() == WaterState::Low, "an unreadable read does not reset the count");
  }
  {
    WaterTracker w;
    feed(w, 80, 3, &t);
    int flips = 0;
    for (int i = 0; i < 40; i++)
      flips += feed(w, (i % 2) ? 28.0f : 31.0f, 1, &t);
    expect(flips == 0, "ripple around the mark never flips");
  }
  {
    expect(std::string_view(water_state_name(WaterState::Ok)) == "ok", "name ok");
    expect(std::string_view(water_state_name(WaterState::Low)) == "low", "name low");
    expect(std::string_view(water_state_name(WaterState::Empty)) == "empty", "name empty");
    expect(std::string_view(water_state_name(WaterState::Unknown)) == "unknown", "name unknown");
  }
  {
    WaterTracker w;
    w.update(80, 1000);
    w.update(80, 2000);
    w.update(80, 3000);
    w.reset();
    expect(w.state() == WaterState::Unknown, "reset forgets the state");
  }
  {
    // Telemetry carries the water fields, and says nothing when there is no water tracking.
    ChamberReading r;
    r.has_temperature = true;
    r.temperature = 21.5f;
    const std::string none = telemetry_body_json(r, 0, nullptr, nullptr);
    expect(none.find("water") == std::string::npos, "no water fields without water tracking");

    r.has_water_level = true;
    r.water_level = 8.04f;
    r.water_state = "empty";
    const std::string empty = telemetry_body_json(r, 0, nullptr, nullptr);
    expect(empty.find("\"water_level\":8.0") != std::string::npos, "water_level sent");
    expect(empty.find("\"water_state\":\"empty\"") != std::string::npos, "water_state sent");
    expect(empty.find("\"water_source\":\"sensor\"") != std::string::npos, "water_source is sensor");
    expect(empty.find("\"water_low\":true") != std::string::npos, "empty is water_low true");

    r.water_state = "ok";
    r.water_level = 70;
    const std::string ok = telemetry_body_json(r, 0, nullptr, nullptr);
    expect(ok.find("\"water_low\":false") != std::string::npos, "ok is water_low false");

    r.water_state = "low";
    expect(telemetry_body_json(r, 0, nullptr, nullptr).find("\"water_low\":true") != std::string::npos,
           "low is water_low true");

    r.water_state = "suspect";
    const std::string sus = telemetry_body_json(r, 0, nullptr, nullptr);
    expect(sus.find("\"water_source\":\"inferred\"") != std::string::npos, "suspect is always inferred");

    r.water_state = "unknown";
    const std::string unk = telemetry_body_json(r, 0, nullptr, nullptr);
    expect(unk.find("\"water_state\":\"unknown\"") != std::string::npos && unk.find("water_low") == std::string::npos,
           "unknown sends no water_low, so the site opens or clears nothing");
  }
  if (fails) {
    std::fprintf(stderr, "%d failed\n", fails);
    return 1;
  }
  std::printf("water level host tests passed\n");
  return 0;
}
