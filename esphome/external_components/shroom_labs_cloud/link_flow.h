#pragma once
// "Link this device" menu flow. Pure logic so the host tests can drive it.
// The YAML feeds it inputs once a second and on button presses, then runs
// whatever LinkAction it returns and draws the LinkScreen it describes.

#include "cloud_format.h"

#include <cstdint>
#include <string>

namespace esphome {
namespace shroom_labs {

enum class LinkView : uint8_t {
  NoWifi,
  Starting,
  Code,
  Finishing,
  JustLinked,
  Linked,
  ConfirmUnlink,
  Unlinking,
  Unlinked,
  TimedOut,
  Canceled,
  Problem,
};

enum class LinkAction : uint8_t { None, Connect, Refresh, Disconnect, WifiSetup, GoGrow, GoMenu };

struct LinkInputs {
  bool wifi{false};
  bool enabled{false};
  bool linked{false};
  bool wiping{false};
  CloudState state{CloudState::Off};
  std::string code;   // formatted claim code, empty when none is live
  uint32_t secs_left{0};
  std::string owner;  // from the server, may be empty
  uint32_t now_ms{0};
};

struct LinkScreen {
  std::string title;
  std::string big;
  std::string line;
  const char *back{"Back"};
  const char *select{""};
  bool qr{false};
};

// One linking try. Past this the flow stops polling and says so.
static constexpr uint32_t LINK_SESSION_MS = 15UL * 60UL * 1000UL;
static constexpr uint32_t LINK_DONE_MS = 4000;
static constexpr uint32_t LINK_NOTE_MS = 3000;

std::string link_owner_line(const std::string &owner);

class LinkFlow {
 public:
  LinkAction open(const LinkInputs &in);
  LinkAction tick(const LinkInputs &in);
  // 1 Back, 4 Select. Others do nothing.
  LinkAction button(int b, const LinkInputs &in);
  LinkView view() const { return view_; }
  LinkScreen screen(const LinkInputs &in) const;

 protected:
  void go_(LinkView v, uint32_t now) {
    view_ = v;
    since_ms_ = now;
  }
  LinkAction stop_(LinkView v, const LinkInputs &in);

  LinkView view_{LinkView::NoWifi};
  uint32_t since_ms_{0};
  uint32_t started_ms_{0};
};

}  // namespace shroom_labs
}  // namespace esphome
