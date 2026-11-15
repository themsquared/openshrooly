#pragma once

#include <cstring>

namespace sl_local {

inline bool status_url(const char *url) { return url != nullptr && std::strcmp(url, "/api/status") == 0; }

inline bool schema_url(const char *url) { return url != nullptr && std::strcmp(url, "/api/status/schema") == 0; }

inline bool owns_url(const char *url) { return status_url(url) || schema_url(url); }

}  // namespace sl_local
