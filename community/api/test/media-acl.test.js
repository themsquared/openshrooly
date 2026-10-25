import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryDb } from "../src/db.js";
import { createMemoryStorage } from "../src/storage.js";
import {
  approvedObjectKey,
  copyApprovedObject,
  deleteStoredObject,
  finishApprovedObject,
  insertMedia,
  pendingSiblingKey,
  replaceMediaKey,
} from "../src/media-acl.js";

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

test("copyApprovedObject copies first and leaves the pending object", async () => {
  const storage = createMemoryStorage();
  await storage.put("pending/reports/a.jpg", jpeg, "image/jpeg");
  const result = await copyApprovedObject(storage, "pending/reports/a.jpg");
  assert.equal(result.nextKey, "reports/a.jpg");
  assert.equal(result.missing, false);
  assert.ok(await storage.get("pending/reports/a.jpg"));
  assert.ok(await storage.get("reports/a.jpg"));
});

test("copy then DB then delete converges when delete fails the first time", async () => {
  const db = createMemoryDb();
  const real = createMemoryStorage();
  let deletes = 0;
  const storage = {
    driver: "memory",
    put: (key, bytes, type) => real.put(key, bytes, type),
    get: (key) => real.get(key),
    async delete(key) {
      deletes += 1;
      if (deletes === 1) throw new Error("transient");
      return real.delete(key);
    },
  };
  const fromKey = "pending/reports/retry.jpg";
  await storage.put(fromKey, jpeg, "image/jpeg");
  await insertMedia(db, { photo_key: fromKey, owner_id: 7, status: "pending", kind: "report" });

  const first = await copyApprovedObject(storage, fromKey);
  assert.equal(first.nextKey, "reports/retry.jpg");
  await replaceMediaKey(db, fromKey, first.nextKey, "approved");
  await deleteStoredObject(storage, fromKey);
  assert.ok(await storage.get(fromKey), "pending object stays if delete throws");
  assert.ok(await storage.get(first.nextKey));
  assert.equal((await db.one("SELECT * FROM uploaded_media WHERE photo_key=?", [first.nextKey])).status, "approved");
  assert.equal(await db.one("SELECT * FROM uploaded_media WHERE photo_key=?", [fromKey]), null);

  const again = await copyApprovedObject(storage, fromKey);
  assert.equal(again.nextKey, first.nextKey);
  await replaceMediaKey(db, fromKey, again.nextKey, "approved");
  await finishApprovedObject(storage, again.nextKey);
  assert.equal(await storage.get(fromKey), null);
  assert.ok(await storage.get(again.nextKey));
});

test("approvedObjectKey and pendingSiblingKey round-trip report and profile keys", () => {
  assert.equal(approvedObjectKey("pending/reports/a.jpg"), "reports/a.jpg");
  assert.equal(pendingSiblingKey("reports/a.jpg"), "pending/reports/a.jpg");
  assert.equal(approvedObjectKey("profile-photos/pending/abc"), "profile-photos/approved/abc");
  assert.equal(pendingSiblingKey("profile-photos/approved/abc"), "profile-photos/pending/abc");
});
