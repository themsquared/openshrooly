/** Object storage: Cloudflare R2 in prod, in-memory Map for tests/local. */

export function createMemoryStorage() {
  const files = new Map();
  return {
    driver: "memory",
    async put(key, bytes, contentType = "application/octet-stream") {
      files.set(key, { bytes, contentType });
      return key;
    },
    async get(key) {
      return files.get(key) || null;
    },
  };
}

export function createR2Storage(bucket) {
  return {
    driver: "r2",
    async put(key, bytes, contentType = "application/octet-stream") {
      await bucket.put(key, bytes, { httpMetadata: { contentType } });
      return key;
    },
    async get(key) {
      const obj = await bucket.get(key);
      if (!obj) return null;
      const bytes = await obj.arrayBuffer();
      return {
        bytes,
        contentType: obj.httpMetadata?.contentType || "application/octet-stream",
      };
    },
  };
}

/** R2 is optional until the account enables it. Missing/broken bindings must not crash the Worker. */
export function createOptionalStorage(bucket) {
  if (!bucket) return createMemoryStorage();
  const inner = createR2Storage(bucket);
  return {
    driver: "r2",
    async put(key, bytes, contentType = "application/octet-stream") {
      try {
        return await inner.put(key, bytes, contentType);
      } catch {
        return key;
      }
    },
    async get(key) {
      try {
        return await inner.get(key);
      } catch {
        return null;
      }
    },
  };
}
