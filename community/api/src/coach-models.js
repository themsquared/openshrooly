/** Swappable model providers. Workers AI in prod; stub in tests. */

export function createModelProvider(env) {
  const name = String(env.GROW_COACH_PROVIDER || "").toLowerCase();
  if (name === "stub" || env.GROW_COACH_STUB === "1") return stubProvider();
  if (env.AI && name !== "stub") return workersAiProvider(env);
  return stubProvider();
}

function stubProvider() {
  return {
    name: "stub",
    async chat({ message, grounding }) {
      const text = String(message || "");
      const device = grounding.device_model || {};
      const reply = [
        "Grow Coach (stub — no live model). Culinary cultivation only.",
        device.sample_count
          ? `This chamber’s humidity error is ${(device.humidity_error ?? 0).toFixed(1)}% and temperature offset is ${(device.temperature_offset ?? 0).toFixed(1)}°C.`
          : "I do not have telemetry for this chamber yet.",
        grounding.alerts?.length ? `Alerts: ${grounding.alerts.map((a) => a.kind).join(", ")}.` : "",
        text.toLowerCase().includes("harvest")
          ? "If veils are thinning and caps are flattening, harvest that flush."
          : "Keep the door sealed and the reservoir filled; I will only suggest setpoint changes inside safe bounds.",
      ]
        .filter(Boolean)
        .join(" ");
      return { text: reply, input_tokens: 200, output_tokens: 80, cached: false };
    },
    async vision({ hint }) {
      const blob = String(hint || "").toLowerCase();
      const flags = [];
      if (/mold|green|trich|contam/.test(blob)) {
        flags.push({ kind: "contamination", label: "Possible mold / contamination", confidence: 0.78 });
      }
      if (/dry|cracked|shrivel/.test(blob)) {
        flags.push({ kind: "too_dry", label: "Block looks dry", confidence: 0.71 });
      }
      if (/pin|primordia/.test(blob)) {
        flags.push({ kind: "pinning", label: "Pinning underway", confidence: 0.74 });
      }
      const stage = /fruit|cap/.test(blob) ? "fruiting" : /pin/.test(blob) ? "pinning" : "colonization";
      const next = flags.some((f) => f.kind === "contamination")
        ? "Isolate the block. Do not fan toward other chambers. Discard if the spot spreads."
        : "Keep humidity in the fruiting band and watch the next 24 hours.";
      return {
        stage,
        flags,
        confidence: flags[0]?.confidence || 0.55,
        next_steps: next,
        input_tokens: 1800,
        output_tokens: 220,
      };
    },
  };
}

function workersAiProvider(env) {
  const textModel = env.GROW_COACH_TEXT_MODEL || "@cf/meta/llama-3.2-3b-instruct";
  const visionModel = env.GROW_COACH_VISION_MODEL || "@cf/meta/llama-3.2-11b-vision-instruct";
  return {
    name: "workers-ai",
    async chat({ message, grounding }) {
      const system =
        "You are Grow Coach for Shroom Labs. Culinary home cultivation only. Never market, price, or coach the off-menu/psilocybin pack. Use only the grounding JSON. Suggest setpoints only inside the provided safe bounds. Be concise.";
      const result = await env.AI.run(textModel, {
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Grounding:\n${JSON.stringify(grounding)}\n\nQuestion: ${message}` },
        ],
      });
      const text = result.response || result.result || result.text || "";
      return {
        text,
        input_tokens: result.usage?.prompt_tokens || 800,
        output_tokens: result.usage?.completion_tokens || 200,
        cached: false,
        model: textModel,
      };
    },
    async vision({ imageBase64, hint }) {
      const result = await env.AI.run(visionModel, {
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Culinary mushroom grow photo. Return JSON: {stage, flags:[{kind,label,confidence}], next_steps}. kinds: contamination, too_dry, pinning, healthy. No psilocybin advice.",
              },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
            ],
          },
        ],
      });
      const raw = result.response || result.result || "";
      let parsed = {};
      try {
        parsed = JSON.parse(String(raw).replace(/^```json|```$/g, "").trim());
      } catch {
        parsed = { stage: "unknown", flags: [], next_steps: String(raw).slice(0, 400), hint };
      }
      return {
        stage: parsed.stage || "unknown",
        flags: parsed.flags || [],
        confidence: parsed.flags?.[0]?.confidence || 0.5,
        next_steps: parsed.next_steps || "Watch humidity and look again tomorrow.",
        input_tokens: result.usage?.prompt_tokens || 2000,
        output_tokens: result.usage?.completion_tokens || 250,
        model: visionModel,
      };
    },
  };
}
