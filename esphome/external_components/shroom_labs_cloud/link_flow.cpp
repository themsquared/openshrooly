#include "link_flow.h"

namespace esphome {
namespace shroom_labs {

std::string link_owner_line(const std::string &owner) {
  std::string clean;
  for (char c : owner) {
    if (c >= 0x20 && c <= 0x7e && clean.size() < 20)
      clean += c;
  }
  if (clean.empty() || clean.find('@') != std::string::npos)
    return "Linked to your account";
  return "Linked to " + clean;
}

static bool waiting(LinkView v) {
  return v == LinkView::Starting || v == LinkView::Code || v == LinkView::Finishing || v == LinkView::Problem;
}

LinkAction LinkFlow::open(const LinkInputs &in) {
  if (!in.wifi) {
    go_(LinkView::NoWifi, in.now_ms);
    return LinkAction::None;
  }
  if (in.linked) {
    go_(LinkView::Linked, in.now_ms);
    return LinkAction::None;
  }
  started_ms_ = in.now_ms;
  if (in.enabled && in.state == CloudState::PendingClaim && !in.code.empty()) {
    go_(LinkView::Code, in.now_ms);
    return LinkAction::None;
  }
  go_(LinkView::Starting, in.now_ms);
  if (in.wiping)
    return LinkAction::None;  // tick() starts once the old link is gone
  if (!in.enabled)
    return LinkAction::Connect;
  if (in.state == CloudState::Connecting || in.state == CloudState::Issuing)
    return LinkAction::None;
  return LinkAction::Refresh;
}

LinkAction LinkFlow::stop_(LinkView v, const LinkInputs &in) {
  go_(v, in.now_ms);
  // Not linked: turn the cloud back off so nothing keeps polling.
  return in.linked ? LinkAction::None : LinkAction::Disconnect;
}

LinkAction LinkFlow::tick(const LinkInputs &in) {
  const uint32_t age = in.now_ms - since_ms_;
  switch (view_) {
    case LinkView::NoWifi:
      return in.wifi ? open(in) : LinkAction::None;
    case LinkView::JustLinked:
      if (age >= LINK_DONE_MS) {
        go_(LinkView::Linked, in.now_ms);
        return LinkAction::GoGrow;
      }
      return LinkAction::None;
    case LinkView::Canceled:
      if (age >= LINK_NOTE_MS) {
        go_(LinkView::NoWifi, in.now_ms);
        return LinkAction::GoMenu;
      }
      return LinkAction::None;
    case LinkView::Unlinking:
      if (!in.linked && !in.wiping)
        go_(LinkView::Unlinked, in.now_ms);
      return LinkAction::None;
    case LinkView::Unlinked:
      if (age >= LINK_NOTE_MS) {
        go_(LinkView::NoWifi, in.now_ms);
        return LinkAction::GoGrow;
      }
      return LinkAction::None;
    case LinkView::Linked:
      if (!in.linked && !in.wiping)
        go_(LinkView::Unlinked, in.now_ms);
      return LinkAction::None;
    default:
      break;
  }
  if (!waiting(view_))
    return LinkAction::None;
  if (in.linked) {
    go_(LinkView::JustLinked, in.now_ms);
    return LinkAction::None;
  }
  if (in.now_ms - started_ms_ >= LINK_SESSION_MS)
    return stop_(LinkView::TimedOut, in);
  if (view_ == LinkView::Starting && in.wiping)
    return LinkAction::None;
  if (view_ == LinkView::Starting && !in.enabled)
    return LinkAction::Connect;  // the old link just finished wiping
  LinkView next = view_;
  switch (in.state) {
    case CloudState::PendingClaim:
      next = in.code.empty() ? LinkView::Starting : LinkView::Code;
      break;
    case CloudState::Issuing:
      next = LinkView::Finishing;
      break;
    case CloudState::Connecting:
    case CloudState::Off:
      next = LinkView::Starting;
      break;
    default:
      next = LinkView::Problem;
      break;
  }
  if (next != view_)
    go_(next, in.now_ms);
  return LinkAction::None;
}

LinkAction LinkFlow::button(int b, const LinkInputs &in) {
  if (b == 1) {
    switch (view_) {
      case LinkView::Starting:
      case LinkView::Code:
      case LinkView::Problem:
        return stop_(LinkView::Canceled, in);
      case LinkView::ConfirmUnlink:
        go_(LinkView::Linked, in.now_ms);
        return LinkAction::None;
      case LinkView::JustLinked:
        go_(LinkView::Linked, in.now_ms);
        return LinkAction::GoGrow;
      default:
        return LinkAction::GoMenu;
    }
  }
  if (b != 4)
    return LinkAction::None;
  switch (view_) {
    case LinkView::NoWifi:
      return in.wifi ? open(in) : LinkAction::WifiSetup;
    case LinkView::Linked:
      if (in.linked)
        go_(LinkView::ConfirmUnlink, in.now_ms);
      return LinkAction::None;
    case LinkView::ConfirmUnlink:
      go_(LinkView::Unlinking, in.now_ms);
      return LinkAction::Disconnect;
    case LinkView::TimedOut:
    case LinkView::Canceled:
    case LinkView::Unlinked:
      return open(in);
    case LinkView::Problem:
      if (in.state == CloudState::Owned)
        return LinkAction::None;
      started_ms_ = in.now_ms;
      go_(LinkView::Starting, in.now_ms);
      return in.enabled ? LinkAction::Refresh : LinkAction::Connect;
    default:
      return LinkAction::None;
  }
}

LinkScreen LinkFlow::screen(const LinkInputs &in) const {
  LinkScreen s;
  s.title = "Link";
  switch (view_) {
    case LinkView::NoWifi:
      s.big = "No Wi-Fi";
      s.line = "Set up Wi-Fi first.\nSelect: Wi-Fi setup";
      s.select = "Wi-Fi";
      break;
    case LinkView::Starting:
      s.big = "...";
      s.line = "Getting a code...";
      s.back = "Cancel";
      break;
    case LinkView::Code: {
      s.big = in.code;
      const uint32_t mins = (in.secs_left + 59) / 60;
      if (mins > 0)
        s.title = "Link  " + std::to_string(mins) + " min";
      s.line = "Scan with your phone while signed in";
      s.back = "Cancel";
      s.qr = true;
      break;
    }
    case LinkView::Finishing:
      s.big = "...";
      s.line = "Almost done...";
      break;
    case LinkView::JustLinked:
      s.big = "Linked";
      s.line = link_owner_line(in.owner);
      s.select = "OK";
      break;
    case LinkView::Linked:
      s.big = "Linked";
      s.line = in.owner.empty() ? "To your Shroom Labs account" : link_owner_line(in.owner);
      s.select = "Unlink";
      break;
    case LinkView::ConfirmUnlink:
      s.big = "Unlink?";
      s.line = "The site stops seeing it.\nSelect to unlink.";
      s.back = "Keep";
      s.select = "Unlink";
      break;
    case LinkView::Unlinking:
      s.big = "...";
      s.line = "Unlinking...";
      break;
    case LinkView::Unlinked:
      s.big = "Unlinked";
      s.line = "It still grows on its own.";
      s.select = "Link";
      break;
    case LinkView::TimedOut:
      s.big = "Timed out";
      s.line = "Not linked.\nSelect to try again.";
      s.select = "Retry";
      break;
    case LinkView::Canceled:
      s.big = "Canceled";
      s.line = "Not linked.";
      s.select = "Retry";
      break;
    case LinkView::Problem:
      s.big = "Not yet";
      if (in.state == CloudState::Owned) {
        s.line = "On another account.\nRemove it on the site.";
      } else if (in.state == CloudState::WaitClaim) {
        s.line = "Busy. Try in a minute.";
        s.select = "Retry";
      } else {
        s.line = "No reply from Shroom Labs.";
        s.select = "Retry";
      }
      s.back = "Cancel";
      break;
  }
  return s;
}

}  // namespace shroom_labs
}  // namespace esphome
