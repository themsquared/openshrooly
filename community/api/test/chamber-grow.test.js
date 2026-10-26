import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chamberPhotoPath, chamberText } from "../src/chamber-grow.js";
import { speciesPhoto } from "../../web/public/js/species-art.js";

const root = new URL("../../../data/profiles/", import.meta.url).pathname;
const builtIns = ["culinary", "psilocybin"].flatMap((pack) =>
  readdirSync(join(root, pack))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(root, pack, f), "utf8")))
);

test("chamber photo matches the site's card photo for every built-in profile", () => {
  assert.ok(builtIns.length > 20);
  for (const p of builtIns) {
    const site = speciesPhoto(p.species || "", p.strain || "", p.name || "", p.pack || "", p.id);
    const want = site ? site.replace(/\.(jpg|webp)$/, "").replace(/-1200$/, "") + "-640.webp" : "";
    assert.equal(chamberPhotoPath(p), want, p.id);
  }
});

test("chamber text is short printable ASCII with nothing that needs escaping", () => {
  assert.equal(chamberText("Lion's Mane", 40), "Lion's Mane");
  assert.equal(chamberText('Bad "<b>"\\ name\u00e9', 40), "Bad b name");
  assert.equal(chamberText("x".repeat(60), 40).length, 40);
});
