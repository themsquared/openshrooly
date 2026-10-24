import {
  STAGE_CATALOG,
  RANGES,
  WAVELENGTH_NOTE,
  STRIP_APPROX_NOTE,
  PSILOCYBIN_LEGAL_NOTICE,
  PUBLISH_STATES,
  blankProfile,
  cloneProfile,
  applyPackRules,
  canCloneFull,
  collectProfileIssues,
  publishReadyIssues,
  syncStageLightFromRecipe,
  parseProfileDocument,
  exportProfileDocument,
  firstIssue,
  slugify,
  cToF,
  fToC,
  defaultStage,
  defaultLightPhase,
  isPsilocybin,
} from "./profile-schema.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fieldId(path) {
  return `pb-${path.replaceAll(".", "-")}`;
}

export class ProfileBuilder extends HTMLElement {
  constructor() {
    super();
    this.mode = "hub";
    this.unit = localStorage.getItem("sl-temp-unit") === "F" ? "F" : "C";
    this.catalog = [];
    this.ownProfiles = [];
    this.publish = { status: "draft", reason: "", title: "", description: "", photos: [] };
    this.locked = false;
    this.profile = blankProfile();
    this.activeStage = "colonization";
    this._onChange = null;
  }

  connectedCallback() {
    this.mode = this.getAttribute("mode") || "hub";
    this.setAttribute("class", `${this.getAttribute("class") || ""} pb`.trim());
    this.render();
  }

  setCatalog(list) {
    this.catalog = Array.isArray(list) ? list : [];
    this.render();
  }

  setOwnProfiles(list) {
    this.ownProfiles = Array.isArray(list) ? list : [];
    this.render();
  }

  setPublishState(state = {}) {
    this.publish = { ...this.publish, ...state };
    this.render();
  }

  setProfile(doc, { locked = false } = {}) {
    this.locked = Boolean(locked);
    this.profile = applyPackRules(structuredClone(doc));
    this.profile.light_recipe = this.profile.light_recipe || blankProfile().light_recipe;
    this.activeStage = this.profile.stages?.[0]?.id || "colonization";
    this.render();
  }

  getDocument() {
    const profile = syncStageLightFromRecipe(applyPackRules(this.profile));
    if (!profile.id && profile.name) profile.id = slugify(profile.name);
    const issues = collectProfileIssues(profile);
    return { profile, issues, ok: issues.length === 0 };
  }

  getPublishPayload() {
    const built = this.getDocument();
    const extras = publishReadyIssues(this.publish);
    return { ...built, publish: this.publish, publishIssues: extras };
  }

  importDocument(textOrObj) {
    const data = parseProfileDocument(textOrObj);
    this.setProfile(data, { locked: Boolean(data.locked) });
    return this.getDocument();
  }

  exportDocument() {
    const { profile } = this.getDocument();
    return exportProfileDocument(profile);
  }

  render() {
    const issues = collectProfileIssues(this.profile);
    const off = isPsilocybin(this.profile);
    const state = PUBLISH_STATES[this.publish.status] || PUBLISH_STATES.draft;
    const stage = this.profile.stages.find((s) => s.id === this.activeStage) || this.profile.stages[0];
    if (stage && stage.id !== this.activeStage) this.activeStage = stage.id;

    this.innerHTML = `
      ${this.mode === "community" ? this.renderState(state) : ""}
      <section class="pb-panel">
        <h2>Profile</h2>
        ${this.locked ? `<p class="notice">This paid recipe keeps its numbers locked. Clone it after you buy it, or start from a free profile.</p>` : ""}
        ${this.renderStartFrom()}
        <div class="pb-row pb-row-2">
          ${this.textField("name", "Name", this.profile.name, issues)}
          ${this.textField("species", "Species", this.profile.species, issues)}
          ${this.textField("strain", "Strain", this.profile.strain || "", issues)}
          ${this.textField("id", "Id", this.profile.id, issues, { hint: "lowercase-hyphens" })}
        </div>
        ${this.areaField("notes", "Notes", this.profile.notes || "", issues)}
        ${this.renderSources(issues)}
        ${this.renderPack(off)}
      </section>
      <section class="pb-panel">
        <div class="pb-banner">
          <h2>Phases</h2>
          ${this.renderUnitToggle()}
        </div>
        ${this.renderTabs()}
        ${stage && !this.locked ? this.renderStage(stage, issues) : this.locked ? `<p class="muted">Phase numbers stay hidden on a locked paid profile.</p>` : ""}
      </section>
      <section class="pb-panel">
        <h2>Light recipe</h2>
        <p class="muted">${escapeHtml(STRIP_APPROX_NOTE)} ${escapeHtml(WAVELENGTH_NOTE)}</p>
        ${this.locked ? `<p class="muted">Hours, brightness, and the RGB mix unlock after purchase.</p>` : this.renderLight(issues)}
      </section>
      <section class="pb-panel">
        <h2>Grow timeline</h2>
        ${this.renderTimeline()}
      </section>
      ${this.mode === "community" ? this.renderPublish(issues) : ""}
      <details class="pb-panel pb-advanced">
        <summary>Advanced: import or export a profile file</summary>
        <p class="muted">For people who already have a profile document. This round-trips the same fields the API stores.</p>
        <textarea id="pb-import" aria-label="Profile document">${escapeHtml(exportProfileDocument(this.profile))}</textarea>
        <div class="pb-actions">
          <button type="button" class="secondary" data-act="import">Load document</button>
          <button type="button" class="secondary" data-act="export">Copy document</button>
        </div>
        <p class="pb-error" id="pb-import-error"></p>
      </details>
    `;
    this.bind();
  }

  renderState(state) {
    const reason = this.publish.reason ? `<p class="notice">${escapeHtml(this.publish.reason)}</p>` : "";
    return `<section class="pb-panel pb-state" data-state="${escapeHtml(this.publish.status)}" aria-live="polite">
      <span class="pb-state-label">${escapeHtml(state.label)}</span>
      <p class="muted" style="margin:0">${escapeHtml(state.hint)}</p>
      ${reason}
    </section>`;
  }

  renderStartFrom() {
    const groups = [
      ["Built-in", this.catalog.filter((p) => !p.author)],
      ["Your profiles", this.ownProfiles],
      ["Library", this.catalog.filter((p) => p.author)],
    ];
    const options = groups
      .map(([label, items]) => {
        if (!items.length) return "";
        return `<optgroup label="${escapeHtml(label)}">${items
          .map((p) => {
            const full = canCloneFull(p, { unlocked: Boolean(p.unlocked) });
            return `<option value="${escapeHtml(p.id)}" ${full ? "" : "data-locked=1"}>${escapeHtml(p.name)}${full ? "" : " (numbers locked)"}</option>`;
          })
          .join("")}</optgroup>`;
      })
      .join("");
    return `<label>Start from an existing profile
      <select id="pb-clone">
        <option value="">Blank profile</option>
        ${options}
      </select>
    </label>`;
  }

  renderPack(off) {
    return `<fieldset>
      <legend>Pack</legend>
      <div class="pb-unit-toggle" role="group" aria-label="Pack">
        <button type="button" data-pack="culinary" aria-pressed="${off ? "false" : "true"}">Culinary</button>
        <button type="button" data-pack="psilocybin" aria-pressed="${off ? "true" : "false"}">Off-menu</button>
      </div>
      ${
        off
          ? `<aside class="legal legal-prominent" role="note"><p>${escapeHtml(PSILOCYBIN_LEGAL_NOTICE)}</p><p>Off-menu profiles stay free. No payments, no affiliate links, and Grow Coach does not cover them.</p></aside>`
          : ""
      }
    </fieldset>`;
  }

  renderUnitToggle() {
    return `<div class="pb-unit-toggle" role="group" aria-label="Temperature unit">
      <button type="button" data-unit="C" aria-pressed="${this.unit === "C" ? "true" : "false"}">C</button>
      <button type="button" data-unit="F" aria-pressed="${this.unit === "F" ? "true" : "false"}">F</button>
    </div>`;
  }

  renderTabs() {
    const unused = STAGE_CATALOG.filter((s) => !this.profile.stages.some((p) => p.id === s.id));
    return `<div class="pb-tabs" role="tablist" aria-label="Grow phases">
      ${this.profile.stages
        .map(
          (s) =>
            `<button type="button" role="tab" id="tab-${s.id}" aria-selected="${s.id === this.activeStage ? "true" : "false"}" aria-controls="panel-${s.id}" data-stage="${s.id}">${escapeHtml(s.name)}</button>`
        )
        .join("")}
    </div>
    <div class="pb-tab-actions">
      ${
        unused.length
          ? `<label>Add phase <select id="pb-add-stage">${unused
              .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
              .join("")}</select></label><button type="button" class="secondary" data-act="add-stage">Add</button>`
          : ""
      }
      ${this.profile.stages.length > 1 ? `<button type="button" class="secondary" data-act="remove-stage">Remove this phase</button>` : ""}
    </div>`;
  }

  renderStage(stage, issues) {
    const temp = this.unit === "F" ? Math.round(cToF(stage.temperature_c) * 10) / 10 : stage.temperature_c;
    const tempRange = this.unit === "F" ? { min: Math.round(cToF(10)), max: Math.round(cToF(35)), unit: "F" } : { ...RANGES.temperature_c, unit: "C" };
    return `<div id="panel-${stage.id}" role="tabpanel" aria-labelledby="tab-${stage.id}">
      ${this.slider("duration_days", "Duration", stage.duration_days, { min: 1, max: 45, step: 1, unit: "days" }, `stages.${stage.id}.duration_days`, issues)}
      ${this.slider("humidity_percent", "Humidity", stage.humidity_percent, { ...RANGES.humidity_percent, step: 1 }, `stages.${stage.id}.humidity_percent`, issues)}
      ${this.slider("temperature", `Temperature (${tempRange.unit})`, temp, { ...tempRange, step: 0.5 }, `stages.${stage.id}.temperature_c`, issues)}
      ${this.slider("fan_speed", "Fresh air", stage.fan?.speed_percent ?? 30, { ...RANGES.fan_speed_percent, step: 1 }, `stages.${stage.id}.fan.speed_percent`, issues)}
      <div class="pb-row pb-row-2">
        ${this.slider("fan_period", "Fan period", stage.fan?.period_min ?? 15, { ...RANGES.fan_period_min, step: 1 }, `stages.${stage.id}.fan.period_min`, issues)}
        ${this.slider("fan_run", "Fan run time", stage.fan?.run_duration_s ?? 30, { ...RANGES.fan_run_duration_s, step: 1 }, `stages.${stage.id}.fan.run_duration_s`, issues)}
      </div>
      ${this.areaField(`stage-notes`, "Phase notes", stage.notes || "", issues, `stages.${stage.id}.notes`)}
    </div>`;
  }

  renderLight(issues) {
    const recipe = this.profile.light_recipe;
    const name = this.activeStage;
    const phase = recipe.phases[name] || (["pinning", "fruiting", "flush"].includes(name) ? recipe.phases.fruiting : recipe.phases.colonization);
    if (!recipe.phases[name]) recipe.phases[name] = structuredClone(phase || defaultLightPhase(name));
    const current = recipe.phases[name];
    const rgb = `rgb(${Math.round((current.red_percent / 100) * 255)}, ${Math.round((current.green_percent / 100) * 255)}, ${Math.round((current.blue_percent / 100) * 255)})`;
    const left = 0;
    const width = (Number(current.photoperiod_hours) / 24) * 100;
    return `
      ${this.textField("light_recipe.why", "Why this mix", recipe.why || "", issues)}
      <p class="muted">${escapeHtml(recipe.wavelength_note || WAVELENGTH_NOTE)}</p>
      ${this.slider("photoperiod", "Hours on", current.photoperiod_hours, { ...RANGES.photoperiod_hours, step: 0.5 }, `light_recipe.phases.${name}.photoperiod_hours`, issues)}
      <div class="pb-clock" aria-hidden="true"><span style="left:${left}%;width:${width}%"></span></div>
      ${this.slider("white", "White brightness", current.white_brightness_percent, { ...RANGES.white_brightness_percent, step: 1 }, `light_recipe.phases.${name}.white_brightness_percent`, issues)}
      <div class="pb-row pb-row-3">
        ${this.slider("red", "Red", current.red_percent, { ...RANGES.rgb_percent, step: 1 }, `light_recipe.phases.${name}.red_percent`, issues)}
        ${this.slider("green", "Green", current.green_percent, { ...RANGES.rgb_percent, step: 1 }, `light_recipe.phases.${name}.green_percent`, issues)}
        ${this.slider("blue", "Blue", current.blue_percent, { ...RANGES.rgb_percent, step: 1 }, `light_recipe.phases.${name}.blue_percent`, issues)}
      </div>
      <div class="pb-field">
        <span>Live color swatch</span>
        <div class="pb-swatch" style="background:${rgb}" aria-label="Approximate strip color"></div>
      </div>
      ${this.renderLightSources(issues)}
    `;
  }

  renderLightSources(issues) {
    const sources = this.profile.light_recipe.sources || [];
    return `<fieldset>
      <legend>Light sources</legend>
      ${sources
        .map(
          (note, i) => `<div class="pb-row pb-row-2">
            ${this.textField(`light_recipe.sources.${i}.title`, "Title", note.title || "", issues)}
            ${this.textField(`light_recipe.sources.${i}.detail`, "Detail", note.detail || "", issues)}
          </div>`
        )
        .join("")}
      <button type="button" class="secondary" data-act="add-light-source">Add source</button>
    </fieldset>`;
  }

  renderSources(issues) {
    const notes = this.profile.source_notes || [];
    return `<fieldset>
      <legend>Sources</legend>
      ${notes
        .map(
          (note, i) => `<div class="pb-row pb-row-2">
            ${this.textField(`source_notes.${i}.title`, "Title", note.title || "", issues)}
            ${this.textField(`source_notes.${i}.detail`, "Detail", note.detail || "", issues)}
          </div>`
        )
        .join("")}
      <button type="button" class="secondary" data-act="add-source">Add source</button>
    </fieldset>`;
  }

  renderTimeline() {
    const stages = this.profile.stages || [];
    const total = stages.reduce((sum, s) => sum + Number(s.duration_days || 0), 0) || 1;
    return `<ol class="pb-timeline" aria-label="Whole grow">
      ${stages
        .map((s) => {
          const days = Number(s.duration_days || 0);
          return `<li style="flex-grow:${Math.max(1, days)}">
            <strong>${escapeHtml(s.name)}</strong><br>
            ${days} d · ${this.locked ? "locked" : `${this.unit === "F" ? Math.round(cToF(s.temperature_c)) + " F" : s.temperature_c + " C"} · ${s.humidity_percent}%`}
          </li>`;
        })
        .join("")}
    </ol>
    <p class="muted">${total} days from start to the last phase.</p>`;
  }

  renderPublish() {
    const extras = publishReadyIssues(this.publish);
    return `<section class="pb-panel" id="publish-community">
      <h2>Share with the community</h2>
      <p>A private profile is ready for your chambers right away. Publishing needs a photo, a title, and a description, then a moderator looks at it.</p>
      ${this.textField("publish.title", "Library title", this.publish.title || "", extras)}
      ${this.areaField("publish.description", "Library description", this.publish.description || "", extras)}
      <div class="pb-field">
        <label for="pb-photos">Photos (one to four)</label>
        <input id="pb-photos" type="file" accept="image/jpeg,image/png,image/webp" multiple>
        <p class="pb-error" id="${fieldId("publish.photos")}">${escapeHtml(firstIssue(extras, "publish.photos"))}</p>
        <div class="pb-photos">
          ${(this.publish.photos || [])
            .map(
              (p, i) => `<figure class="pb-photo">
                <img src="${escapeHtml(p.preview || p.url)}" alt="${escapeHtml(p.name || "Profile photo")}">
                <button type="button" class="secondary" data-remove-photo="${i}">Remove</button>
              </figure>`
            )
            .join("")}
        </div>
      </div>
    </section>`;
  }

  textField(path, label, value, issues, { hint } = {}) {
    const id = fieldId(path);
    const err = firstIssue(issues, path);
    return `<label class="pb-field" for="${id}">${escapeHtml(label)}
      <input id="${id}" data-path="${escapeHtml(path)}" value="${escapeHtml(value)}" ${err ? `aria-invalid="true" aria-describedby="${id}-err"` : ""}>
      ${hint ? `<span class="muted">${escapeHtml(hint)}</span>` : ""}
      <span class="pb-error" id="${id}-err">${escapeHtml(err)}</span>
    </label>`;
  }

  areaField(path, label, value, issues, issuePath = path) {
    const id = fieldId(path);
    const err = firstIssue(issues, issuePath);
    return `<label class="pb-field" for="${id}">${escapeHtml(label)}
      <textarea id="${id}" data-path="${escapeHtml(issuePath)}" rows="3" ${err ? `aria-invalid="true" aria-describedby="${id}-err"` : ""}>${escapeHtml(value)}</textarea>
      <span class="pb-error" id="${id}-err">${escapeHtml(err)}</span>
    </label>`;
  }

  slider(name, label, value, range, path, issues) {
    const id = fieldId(path);
    const err = firstIssue(issues, path);
    return `<div class="pb-field">
      <label for="${id}">${escapeHtml(label)} <span class="pb-unit">${escapeHtml(range.unit || "")}</span></label>
      <div class="pb-control">
        <input id="${id}" type="range" min="${range.min}" max="${range.max}" step="${range.step || 1}" value="${value}" data-path="${escapeHtml(path)}" ${err ? `aria-invalid="true" aria-describedby="${id}-err"` : ""}>
        <input type="number" min="${range.min}" max="${range.max}" step="${range.step || 1}" value="${value}" data-path="${escapeHtml(path)}" aria-label="${escapeHtml(label)} number">
      </div>
      <span class="pb-error" id="${id}-err">${escapeHtml(err)}</span>
    </div>`;
  }

  bind() {
    this.querySelectorAll("[data-path]").forEach((el) => {
      el.addEventListener("input", () => this.updatePath(el.dataset.path, el.value, el));
    });
    this.querySelector("#pb-clone")?.addEventListener("change", (ev) => this.cloneFrom(ev.target.value));
    this.querySelectorAll("[data-unit]").forEach((btn) =>
      btn.addEventListener("click", () => {
        this.unit = btn.dataset.unit;
        localStorage.setItem("sl-temp-unit", this.unit);
        this.render();
      })
    );
    this.querySelectorAll("[data-pack]").forEach((btn) =>
      btn.addEventListener("click", () => {
        this.profile.pack = btn.dataset.pack;
        this.profile = applyPackRules(this.profile);
        this.render();
      })
    );
    this.querySelectorAll("[data-stage]").forEach((btn) =>
      btn.addEventListener("click", () => {
        this.activeStage = btn.dataset.stage;
        this.render();
      })
    );
    this.querySelector("[data-act=add-stage]")?.addEventListener("click", () => {
      const id = this.querySelector("#pb-add-stage")?.value;
      if (!id) return;
      this.profile.stages.push(defaultStage(id));
      this.profile.light_recipe.phases[id] = this.profile.light_recipe.phases[id] || defaultLightPhase(id);
      this.activeStage = id;
      this.render();
    });
    this.querySelector("[data-act=remove-stage]")?.addEventListener("click", () => {
      if (this.profile.stages.length < 2) return;
      this.profile.stages = this.profile.stages.filter((s) => s.id !== this.activeStage);
      this.activeStage = this.profile.stages[0].id;
      this.render();
    });
    this.querySelector("[data-act=add-source]")?.addEventListener("click", () => {
      this.profile.source_notes = this.profile.source_notes || [];
      this.profile.source_notes.push({ title: "", detail: "" });
      this.render();
    });
    this.querySelector("[data-act=add-light-source]")?.addEventListener("click", () => {
      this.profile.light_recipe.sources.push({ title: "", detail: "" });
      this.render();
    });
    this.querySelector("[data-act=import]")?.addEventListener("click", () => {
      const box = this.querySelector("#pb-import-error");
      try {
        this.importDocument(this.querySelector("#pb-import").value);
        box.textContent = "";
      } catch (err) {
        box.textContent = err.message;
      }
    });
    this.querySelector("[data-act=export]")?.addEventListener("click", async () => {
      const text = this.exportDocument();
      this.querySelector("#pb-import").value = text;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        this.querySelector("#pb-import").select();
      }
    });
    this.querySelector("#pb-photos")?.addEventListener("change", (ev) => this.addPhotos(ev.target.files));
    this.querySelectorAll("[data-remove-photo]").forEach((btn) =>
      btn.addEventListener("click", () => {
        this.publish.photos.splice(Number(btn.dataset.removePhoto), 1);
        this.render();
      })
    );
  }

  updatePath(path, raw) {
    if (path === "publish.title") {
      this.publish.title = raw;
      return;
    }
    if (path === "publish.description") {
      this.publish.description = raw;
      return;
    }
    if (path.startsWith("source_notes.")) {
      const [, index, key] = path.split(".");
      this.profile.source_notes[Number(index)][key] = raw;
      this.refreshErrors();
      return;
    }
    if (path.startsWith("light_recipe.sources.")) {
      const parts = path.split(".");
      this.profile.light_recipe.sources[Number(parts[2])][parts[3]] = raw;
      this.refreshErrors();
      return;
    }
    if (path === "light_recipe.why") {
      this.profile.light_recipe.why = raw;
      this.refreshErrors();
      return;
    }
    if (path === "name") {
      this.profile.name = raw;
      if (!this.profile.id || this.profile.id === slugify(this.profile.name.slice(0, -1))) this.profile.id = slugify(raw);
      this.refreshErrors();
      return;
    }
    if (path === "species" || path === "strain" || path === "id" || path === "notes") {
      this.profile[path] = raw;
      this.refreshErrors();
      return;
    }
    const stage = this.profile.stages.find((s) => s.id === this.activeStage);
    if (path.endsWith(".duration_days")) stage.duration_days = Number(raw);
    else if (path.endsWith(".humidity_percent")) stage.humidity_percent = Number(raw);
    else if (path.endsWith(".temperature_c")) {
      stage.temperature_c = this.unit === "F" ? Math.round(fToC(Number(raw)) * 10) / 10 : Number(raw);
    } else if (path.endsWith(".notes")) stage.notes = raw;
    else if (path.endsWith("fan.speed_percent")) stage.fan.speed_percent = Number(raw);
    else if (path.endsWith("fan.period_min")) stage.fan.period_min = Number(raw);
    else if (path.endsWith("fan.run_duration_s")) stage.fan.run_duration_s = Number(raw);
    else if (path.includes("light_recipe.phases.")) {
      const key = path.split(".").pop();
      const id = path.split(".")[2];
      this.profile.light_recipe.phases[id][key] = Number(raw);
      this.profile = syncStageLightFromRecipe(this.profile);
    }
    this.syncPair(path, raw);
    this.refreshErrors();
  }

  syncPair(path, raw) {
    const inputs = this.querySelectorAll(`[data-path="${path}"]`);
    for (const el of inputs) {
      if (el.value !== String(raw)) el.value = raw;
    }
    if (path.includes("light_recipe.phases.")) {
      const id = path.split(".")[2];
      const phase = this.profile.light_recipe.phases[id];
      const swatch = this.querySelector(".pb-swatch");
      if (swatch && phase) {
        swatch.style.background = `rgb(${Math.round((phase.red_percent / 100) * 255)}, ${Math.round((phase.green_percent / 100) * 255)}, ${Math.round((phase.blue_percent / 100) * 255)})`;
      }
      const clock = this.querySelector(".pb-clock span");
      if (clock && phase) clock.style.width = `${(Number(phase.photoperiod_hours) / 24) * 100}%`;
    }
  }

  refreshErrors() {
    const issues = collectProfileIssues(this.profile);
    const extras = this.mode === "community" ? publishReadyIssues(this.publish) : [];
    for (const el of this.querySelectorAll("[data-path]")) {
      const err = firstIssue([...issues, ...extras], el.dataset.path);
      el.setAttribute("aria-invalid", err ? "true" : "false");
      const box = this.querySelector(`#${fieldId(el.dataset.path)}-err`);
      if (box) box.textContent = err;
    }
    this.dispatchEvent(new CustomEvent("profilechange", { detail: this.getDocument() }));
  }

  cloneFrom(id) {
    if (!id) {
      this.setProfile(blankProfile());
      return;
    }
    const source = [...this.catalog, ...this.ownProfiles].find((p) => p.id === id);
    if (!source) return;
    const locked = !canCloneFull(source, { unlocked: Boolean(source.unlocked) });
    this.setProfile(cloneProfile(source, { id: `${slugify(source.name)}-copy`, name: `${source.name} copy` }), { locked });
  }

  addPhotos(fileList) {
    const files = [...fileList];
    for (const file of files) {
      if (this.publish.photos.length >= 4) break;
      const preview = URL.createObjectURL(file);
      this.publish.photos.push({ file, name: file.name, preview });
    }
    this.render();
  }
}

if (!customElements.get("profile-builder")) {
  customElements.define("profile-builder", ProfileBuilder);
}
