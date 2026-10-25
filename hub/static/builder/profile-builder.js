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
  whiteLuxToPercent,
  parseProfileDocument,
  exportProfileDocument,
  firstIssue,
  slugify,
  cToF,
  fToC,
  defaultStage,
  defaultLightPhase,
  isPsilocybin,
  isStageId,
  isHttpsSourceUrl,
  lightOnSummary,
} from "./profile-schema.js";

function fieldId(path) {
  return `pb-${String(path).replace(/[^a-zA-Z0-9._-]/g, "")}`;
}

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "style" && value && typeof value === "object") Object.assign(node.style, value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "checked" || key === "selected" || key === "disabled") node[key] = Boolean(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
  }
  return node;
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
    this.showPsilocybin = true;
    this._onChange = null;
  }

  setShowPsilocybin(on) {
    this.showPsilocybin = Boolean(on);
    this.render();
  }

  connectedCallback() {
    this.mode = this.getAttribute("mode") || "hub";
    this.classList.add("pb");
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
    const first = (this.profile.stages || []).find((s) => isStageId(s.id));
    this.activeStage = first?.id || "colonization";
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
    const stage = (this.profile.stages || []).find((s) => s.id === this.activeStage && isStageId(s.id)) || this.profile.stages[0];
    if (stage && isStageId(stage.id) && stage.id !== this.activeStage) this.activeStage = stage.id;

    const root = [];
    if (this.mode === "community") root.push(this.renderState(state));
    root.push(
      h("section", { class: "pb-panel" },
        h("h2", {}, "Profile"),
        this.locked ? h("p", { class: "notice" }, "This paid recipe keeps its numbers locked. Clone it after you buy it, or start from a free profile.") : null,
        this.renderStartFrom(),
        h("div", { class: "pb-row pb-row-2" },
          this.textField("name", "Name", this.profile.name, issues),
          this.textField("species", "Species", this.profile.species, issues),
          this.textField("strain", "Strain", this.profile.strain || "", issues),
          this.textField("id", "Id", this.profile.id, issues, { hint: "lowercase-hyphens" })
        ),
        this.areaField("notes", "Notes", this.profile.notes || "", issues),
        this.renderSources(issues),
        this.renderPack(off)
      ),
      h("section", { class: "pb-panel" },
        h("div", { class: "pb-banner" }, h("h2", {}, "Phases"), this.renderUnitToggle()),
        this.renderTabs(),
        stage && !this.locked
          ? this.renderStage(stage, issues)
          : this.locked
            ? h("p", { class: "muted" }, "Phase numbers stay hidden on a locked paid profile.")
            : null
      ),
      h("section", { class: "pb-panel" },
        h("h2", {}, "Light recipe"),
        h("p", { class: "muted" }, `${STRIP_APPROX_NOTE} ${WAVELENGTH_NOTE}`),
        this.locked ? h("p", { class: "muted" }, "Hours, brightness, and the RGB mix unlock after purchase.") : this.renderLight(issues)
      ),
      h("section", { class: "pb-panel" }, h("h2", {}, "Grow timeline"), this.renderTimeline())
    );
    if (this.mode === "community") root.push(this.renderPublish());
    const importBox = h("textarea", { id: "pb-import", "aria-label": "Profile document" });
    importBox.value = exportProfileDocument(this.profile);
    root.push(
      h("details", { class: "pb-panel pb-advanced" },
        h("summary", {}, "Advanced: import or export a profile file"),
        h("p", { class: "muted" }, "For people who already have a profile document. This round-trips the same fields the API stores."),
        importBox,
        h("div", { class: "pb-actions" },
          h("button", { type: "button", class: "secondary", dataset: { act: "import" } }, "Load document"),
          h("button", { type: "button", class: "secondary", dataset: { act: "export" } }, "Copy document")
        ),
        h("p", { class: "pb-error", id: "pb-import-error" })
      )
    );
    this.replaceChildren(...root.filter(Boolean));
    this.bind();
  }

  renderState(state) {
    const liveEdit = this.publish.status === "pending" && this.publish.published_live;
    const shown = liveEdit ? PUBLISH_STATES.pending_live : state;
    return h("section", { class: "pb-panel pb-state", dataset: { state: liveEdit ? "pending_live" : this.publish.status }, "aria-live": "polite" },
      h("span", { class: "pb-state-label" }, shown.label),
      h("p", { class: "muted", style: { margin: "0" } }, shown.hint),
      this.publish.reason ? h("p", { class: "notice" }, this.publish.reason) : null
    );
  }

  renderStartFrom() {
    const select = h("select", { id: "pb-clone" }, h("option", { value: "" }, "Blank profile"));
    const groups = [
      ["Built-in", this.catalog.filter((p) => !p.author)],
      ["Your profiles", this.ownProfiles],
      ["Library", this.catalog.filter((p) => p.author)],
    ];
    for (const [label, items] of groups) {
      if (!items.length) continue;
      const group = h("optgroup", { label });
      for (const p of items) {
        const full = canCloneFull(p, { unlocked: Boolean(p.unlocked) });
        const option = h("option", { value: p.id }, full ? p.name : `${p.name} (numbers locked)`);
        group.append(option);
      }
      select.append(group);
    }
    return h("label", {}, "Start from an existing profile", select);
  }

  renderPack(off) {
    const toggle = this.showPsilocybin
      ? h("div", { class: "pb-unit-toggle", role: "group", "aria-label": "Pack" },
          h("button", { type: "button", dataset: { pack: "culinary" }, "aria-pressed": off ? "false" : "true" }, "Culinary"),
          h("button", { type: "button", dataset: { pack: "psilocybin" }, "aria-pressed": off ? "true" : "false" }, "Off-menu")
        )
      : h("p", { class: "muted" }, "Culinary");
    return h("fieldset", {},
      h("legend", {}, "Pack"),
      toggle,
      off
        ? h("aside", { class: "legal legal-prominent", role: "note" },
            h("p", {}, PSILOCYBIN_LEGAL_NOTICE),
            h("p", {}, "Off-menu profiles stay free. No payments, no affiliate links, and Grow Coach does not cover them.")
          )
        : null
    );
  }

  renderUnitToggle() {
    return h("div", { class: "pb-unit-toggle", role: "group", "aria-label": "Temperature unit" },
      h("button", { type: "button", dataset: { unit: "C" }, "aria-pressed": this.unit === "C" ? "true" : "false" }, "C"),
      h("button", { type: "button", dataset: { unit: "F" }, "aria-pressed": this.unit === "F" ? "true" : "false" }, "F")
    );
  }

  renderTabs() {
    const unused = STAGE_CATALOG.filter((s) => !this.profile.stages.some((p) => p.id === s.id));
    const tabs = h("div", { class: "pb-tabs", role: "tablist", "aria-label": "Grow phases" });
    for (const s of this.profile.stages) {
      if (!isStageId(s.id)) continue;
      tabs.append(
        h("button", {
          type: "button",
          role: "tab",
          id: `tab-${s.id}`,
          "aria-selected": s.id === this.activeStage ? "true" : "false",
          "aria-controls": `panel-${s.id}`,
          dataset: { stage: s.id },
        }, s.name)
      );
    }
    const actions = h("div", { class: "pb-tab-actions" });
    if (unused.length) {
      const select = h("select", { id: "pb-add-stage" });
      for (const s of unused) select.append(h("option", { value: s.id }, s.name));
      actions.append(h("label", {}, "Add phase ", select), h("button", { type: "button", class: "secondary", dataset: { act: "add-stage" } }, "Add"));
    }
    if (this.profile.stages.length > 1) {
      actions.append(h("button", { type: "button", class: "secondary", dataset: { act: "remove-stage" } }, "Remove this phase"));
    }
    return h("div", {}, tabs, actions);
  }

  renderStage(stage, issues) {
    if (!isStageId(stage.id)) return h("p", { class: "notice" }, "This phase id is not allowed.");
    const temp = this.unit === "F" ? Math.round(cToF(stage.temperature_c) * 10) / 10 : stage.temperature_c;
    const tempRange = this.unit === "F" ? { min: Math.round(cToF(10)), max: Math.round(cToF(35)), unit: "F" } : { ...RANGES.temperature_c, unit: "C" };
    return h("div", { id: `panel-${stage.id}`, role: "tabpanel", "aria-labelledby": `tab-${stage.id}` },
      this.slider("duration_days", "Duration", stage.duration_days, { min: 1, max: 45, step: 1, unit: "days" }, `stages.${stage.id}.duration_days`, issues),
      this.slider("humidity_percent", "Humidity", stage.humidity_percent, { ...RANGES.humidity_percent, step: 1 }, `stages.${stage.id}.humidity_percent`, issues),
      this.slider("temperature", `Temperature (${tempRange.unit})`, temp, { ...tempRange, step: 0.5 }, `stages.${stage.id}.temperature_c`, issues),
      this.slider("fan_speed", "Fresh air", stage.fan?.speed_percent ?? 30, { ...RANGES.fan_speed_percent, step: 1 }, `stages.${stage.id}.fan.speed_percent`, issues),
      h("div", { class: "pb-row pb-row-2" },
        this.slider("fan_period", "Fan period", stage.fan?.period_min ?? 15, { ...RANGES.fan_period_min, step: 1 }, `stages.${stage.id}.fan.period_min`, issues),
        this.slider("fan_run", "Fan run time", stage.fan?.run_duration_s ?? 30, { ...RANGES.fan_run_duration_s, step: 1 }, `stages.${stage.id}.fan.run_duration_s`, issues)
      ),
      this.renderStageLight(stage, issues),
      this.areaField("stage-notes", "Phase notes", stage.notes || "", issues, `stages.${stage.id}.notes`)
    );
  }

  renderStageLight(stage, issues) {
    const light = stage.light || {};
    const sunrise = light.sunrise_hour ?? 8;
    const duration = light.duration_hours ?? 0;
    return h("fieldset", { class: "pb-stage-light" },
      h("legend", {}, "Light for this phase"),
      h("p", { class: "muted", id: `light-summary-${stage.id}` }, lightOnSummary(sunrise, duration)),
      h("p", { class: "muted" }, "Duration is required when the light is on. 0 hours is only for a dark phase with lux 0 and RGB 0."),
      this.slider("sunrise", "Sunrise hour", sunrise, { ...RANGES.sunrise_hour, step: 1 }, `stages.${stage.id}.light.sunrise_hour`, issues),
      this.slider("light_hours", "Hours on", duration, { ...RANGES.photoperiod_hours, step: 0.25 }, `stages.${stage.id}.light.duration_hours`, issues),
      this.slider("lux", "White lux", light.white_led_lux ?? 0, { ...RANGES.white_led_lux, step: 1 }, `stages.${stage.id}.light.white_led_lux`, issues),
      h("div", { class: "pb-row pb-row-3" },
        this.slider("stage-red", "Red", light.red_percent ?? 0, { ...RANGES.rgb_percent, step: 1 }, `stages.${stage.id}.light.red_percent`, issues),
        this.slider("stage-green", "Green", light.green_percent ?? 0, { ...RANGES.rgb_percent, step: 1 }, `stages.${stage.id}.light.green_percent`, issues),
        this.slider("stage-blue", "Blue", light.blue_percent ?? 0, { ...RANGES.rgb_percent, step: 1 }, `stages.${stage.id}.light.blue_percent`, issues)
      )
    );
  }

  renderLight(issues) {
    const recipe = this.profile.light_recipe;
    const name = isStageId(this.activeStage) ? this.activeStage : "colonization";
    const phase = recipe.phases[name] || (["pinning", "fruiting", "flush"].includes(name) ? recipe.phases.fruiting : recipe.phases.colonization);
    if (!recipe.phases[name]) recipe.phases[name] = structuredClone(phase || defaultLightPhase(name));
    const current = recipe.phases[name];
    const rgb = `rgb(${Math.round((current.red_percent / 100) * 255)}, ${Math.round((current.green_percent / 100) * 255)}, ${Math.round((current.blue_percent / 100) * 255)})`;
    const width = (Number(current.photoperiod_hours) / 24) * 100;
    return h("div", {},
      this.textField("light_recipe.why", "Why this mix", recipe.why || "", issues),
      h("p", { class: "muted" }, recipe.wavelength_note || WAVELENGTH_NOTE),
      this.slider("photoperiod", "Hours on", current.photoperiod_hours, { ...RANGES.photoperiod_hours, step: 0.5 }, `light_recipe.phases.${name}.photoperiod_hours`, issues),
      h("div", { class: "pb-clock", "aria-hidden": "true" }, h("span", { style: { left: "0%", width: `${width}%` } })),
      this.slider("white", "White brightness", current.white_brightness_percent, { ...RANGES.white_brightness_percent, step: 1 }, `light_recipe.phases.${name}.white_brightness_percent`, issues),
      h("div", { class: "pb-row pb-row-3" },
        this.slider("red", "Red", current.red_percent, { ...RANGES.rgb_percent, step: 1 }, `light_recipe.phases.${name}.red_percent`, issues),
        this.slider("green", "Green", current.green_percent, { ...RANGES.rgb_percent, step: 1 }, `light_recipe.phases.${name}.green_percent`, issues),
        this.slider("blue", "Blue", current.blue_percent, { ...RANGES.rgb_percent, step: 1 }, `light_recipe.phases.${name}.blue_percent`, issues)
      ),
      h("div", { class: "pb-field" },
        h("span", {}, "Live color swatch"),
        h("div", { class: "pb-swatch", style: { background: rgb }, "aria-label": "Approximate strip color" })
      ),
      this.renderLightSources(issues)
    );
  }

  renderLightSources(issues) {
    const sources = this.profile.light_recipe.sources || [];
    const box = h("fieldset", {}, h("legend", {}, "Light sources"));
    sources.forEach((note, i) => {
      box.append(
        h("div", { class: "pb-row pb-row-2" },
          this.textField(`light_recipe.sources.${i}.title`, "Title", note.title || "", issues),
          this.textField(`light_recipe.sources.${i}.detail`, "Detail", note.detail || "", issues)
        ),
        this.textField(`light_recipe.sources.${i}.url`, "Source link", note.url || "", issues, { hint: "https only" })
      );
    });
    box.append(h("button", { type: "button", class: "secondary", dataset: { act: "add-light-source" } }, "Add source"));
    return box;
  }

  renderSources(issues) {
    const notes = this.profile.source_notes || [];
    const box = h("fieldset", {}, h("legend", {}, "Sources"));
    notes.forEach((note, i) => {
      box.append(
        h("div", { class: "pb-row pb-row-2" },
          this.textField(`source_notes.${i}.title`, "Title", note.title || "", issues),
          this.textField(`source_notes.${i}.detail`, "Detail", note.detail || "", issues)
        )
      );
    });
    box.append(h("button", { type: "button", class: "secondary", dataset: { act: "add-source" } }, "Add source"));
    return box;
  }

  renderTimeline() {
    const stages = this.profile.stages || [];
    const total = stages.reduce((sum, s) => sum + Number(s.duration_days || 0), 0) || 1;
    const list = h("ol", { class: "pb-timeline", "aria-label": "Whole grow" });
    for (const s of stages) {
      const days = Number(s.duration_days || 0);
      const detail = this.locked
        ? "locked"
        : `${this.unit === "F" ? Math.round(cToF(s.temperature_c)) + " F" : s.temperature_c + " C"} · ${s.humidity_percent}%`;
      const item = h("li", { style: { flexGrow: String(Math.max(1, days)) } },
        h("strong", {}, s.name),
        document.createTextNode(` ${days} d · ${detail}`)
      );
      list.append(item);
    }
    return h("div", {}, list, h("p", { class: "muted" }, `${total} days from start to the last phase.`));
  }

  renderPublish() {
    const extras = publishReadyIssues(this.publish);
    const photos = h("div", { class: "pb-photos" });
    (this.publish.photos || []).forEach((p, i) => {
      const img = h("img", { alt: p.name || "Profile photo" });
      if (p.preview || p.url) img.setAttribute("src", p.preview || p.url);
      photos.append(
        h("figure", { class: "pb-photo" },
          img,
          h("button", { type: "button", class: "secondary", dataset: { removePhoto: String(i) } }, "Remove")
        )
      );
    });
    return h("section", { class: "pb-panel", id: "publish-community" },
      h("h2", {}, "Share with the community"),
      h("p", {}, "A private profile is ready for your chambers right away. Publishing needs a photo, a title, and a description, then a moderator looks at it."),
      this.textField("publish.title", "Library title", this.publish.title || "", extras),
      this.areaField("publish.description", "Library description", this.publish.description || "", extras),
      h("div", { class: "pb-field" },
        h("label", { for: "pb-photos" }, "Photos (one to four)"),
        h("input", { id: "pb-photos", type: "file", accept: "image/jpeg,image/png,image/webp", multiple: true }),
        h("p", { class: "pb-error", id: fieldId("publish.photos") }, firstIssue(extras, "publish.photos")),
        photos
      )
    );
  }

  textField(path, label, value, issues, { hint } = {}) {
    const id = fieldId(path);
    const err = firstIssue(issues, path);
    const input = h("input", { id, dataset: { path } });
    input.value = value ?? "";
    if (err) {
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", `${id}-err`);
    }
    return h("label", { class: "pb-field", for: id },
      label,
      input,
      hint ? h("span", { class: "muted" }, hint) : null,
      h("span", { class: "pb-error", id: `${id}-err` }, err)
    );
  }

  areaField(path, label, value, issues, issuePath = path) {
    const id = fieldId(path);
    const err = firstIssue(issues, issuePath);
    const box = h("textarea", { id, dataset: { path: issuePath }, rows: "3" });
    box.value = value ?? "";
    if (err) {
      box.setAttribute("aria-invalid", "true");
      box.setAttribute("aria-describedby", `${id}-err`);
    }
    return h("label", { class: "pb-field", for: id },
      label,
      box,
      h("span", { class: "pb-error", id: `${id}-err` }, err)
    );
  }

  slider(name, label, value, range, path, issues) {
    const id = fieldId(path);
    const err = firstIssue(issues, path);
    const rangeEl = h("input", {
      id,
      type: "range",
      min: String(range.min),
      max: String(range.max),
      step: String(range.step || 1),
      dataset: { path },
    });
    rangeEl.value = String(value ?? range.min);
    const numberEl = h("input", {
      type: "number",
      min: String(range.min),
      max: String(range.max),
      step: String(range.step || 1),
      dataset: { path },
      "aria-label": `${label} number`,
    });
    numberEl.value = String(value ?? range.min);
    if (err) {
      rangeEl.setAttribute("aria-invalid", "true");
      rangeEl.setAttribute("aria-describedby", `${id}-err`);
    }
    return h("div", { class: "pb-field" },
      h("label", { for: id }, label, " ", h("span", { class: "pb-unit" }, range.unit || "")),
      h("div", { class: "pb-control" }, rangeEl, numberEl),
      h("span", { class: "pb-error", id: `${id}-err` }, err)
    );
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
        if (!isStageId(btn.dataset.stage)) return;
        this.activeStage = btn.dataset.stage;
        this.render();
      })
    );
    this.querySelector("[data-act=add-stage]")?.addEventListener("click", () => {
      const id = this.querySelector("#pb-add-stage")?.value;
      if (!isStageId(id)) return;
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
      this.profile.light_recipe.sources.push({ title: "", detail: "", url: "" });
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
      const key = parts[3];
      const value = key === "url" && raw && !isHttpsSourceUrl(raw) ? raw : raw;
      this.profile.light_recipe.sources[Number(parts[2])][key] = value;
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
      this.profile = applyPackRules(this.profile);
      this.refreshErrors();
      return;
    }
    if (path === "species" || path === "strain" || path === "id" || path === "notes") {
      this.profile[path] = raw;
      this.profile = applyPackRules(this.profile);
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
    else if (path.includes(".light.")) {
      stage.light = stage.light || {};
      const key = path.split(".").pop();
      stage.light[key] = Number(raw);
      const recipe = this.profile.light_recipe;
      if (recipe?.phases) {
        recipe.phases[stage.id] = recipe.phases[stage.id] || defaultLightPhase(stage.id);
        const phase = recipe.phases[stage.id];
        if (key === "duration_hours") phase.photoperiod_hours = Number(raw);
        if (key === "white_led_lux") phase.white_brightness_percent = Math.round(whiteLuxToPercent(raw));
        if (key === "red_percent" || key === "green_percent" || key === "blue_percent") phase[key] = Number(raw);
      }
    }
    else if (path.includes("light_recipe.phases.")) {
      const key = path.split(".").pop();
      const id = path.split(".")[2];
      if (!isStageId(id)) return;
      this.profile.light_recipe.phases[id][key] = Number(raw);
      this.profile = syncStageLightFromRecipe(this.profile);
    }
    this.syncPair(path, raw);
    this.refreshErrors();
  }

  syncPair(path, raw) {
    const inputs = this.querySelectorAll("[data-path]");
    for (const el of inputs) {
      if (el.dataset.path === path && el.value !== String(raw)) el.value = raw;
    }
    if (path.includes("light_recipe.phases.")) {
      const id = path.split(".")[2];
      if (!isStageId(id)) return;
      const phase = this.profile.light_recipe.phases[id];
      const swatch = this.querySelector(".pb-swatch");
      if (swatch && phase) {
        swatch.style.background = `rgb(${Math.round((phase.red_percent / 100) * 255)}, ${Math.round((phase.green_percent / 100) * 255)}, ${Math.round((phase.blue_percent / 100) * 255)})`;
      }
      const clock = this.querySelector(".pb-clock span");
      if (clock && phase) clock.style.width = `${(Number(phase.photoperiod_hours) / 24) * 100}%`;
    }
    if (path.includes(".light.")) {
      const stage = this.profile.stages.find((s) => s.id === this.activeStage);
      const box = this.querySelector(`#light-summary-${this.activeStage}`);
      if (box && stage?.light) box.textContent = lightOnSummary(stage.light.sunrise_hour, stage.light.duration_hours);
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

  async cloneFrom(id) {
    if (!id) {
      this.setProfile(blankProfile());
      return;
    }
    let source = [...this.catalog, ...this.ownProfiles].find((p) => p.id === id);
    if (!source) return;
    if (typeof this.resolveSource === "function" && !Array.isArray(source.stages)) {
      try {
        const resolved = await this.resolveSource(id);
        source = resolved || source;
      } catch {
        /* keep the summary and fall back to a blank clone */
      }
    }
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

export { h, fieldId };
