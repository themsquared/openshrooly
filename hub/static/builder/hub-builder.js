import { ProfileBuilder } from "./profile-builder.js";

const builder = document.querySelector("profile-builder");
const form = document.querySelector("#builder-form");
const field = document.querySelector("#document");
const clone = document.querySelector("#hub-clone");

function catalogFromPage() {
  try {
    return JSON.parse(document.getElementById("profile-catalog")?.textContent || "[]");
  } catch {
    return [];
  }
}

if (builder) {
  customElements.whenDefined("profile-builder").then(() => {
    const catalog = catalogFromPage();
    builder.setCatalog(catalog);
    const preset = document.getElementById("profile-preset");
    if (preset?.textContent) {
      try {
        builder.setProfile(JSON.parse(preset.textContent));
      } catch {
        /* blank */
      }
    }
  });
}

clone?.addEventListener("change", () => {
  if (!builder || !clone.value) return;
  builder.cloneFrom(clone.value);
});

form?.addEventListener("submit", (ev) => {
  if (!builder) return;
  const built = builder.getDocument();
  if (!built.ok) {
    ev.preventDefault();
    const box = document.getElementById("builder-error");
    if (box) {
      box.textContent = built.issues[0]?.message || "Fix the marked fields first.";
      box.hidden = false;
    }
    return;
  }
  field.value = JSON.stringify(built.profile);
});

void ProfileBuilder;
