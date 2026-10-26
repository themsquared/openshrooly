/** Swappable model providers. Workers AI binding in prod; REST only when ENVIRONMENT=local. */

import { coachAiConfigured, coachLocalRestEnabled, comingSoonBody, devStubsEnabled, isProdHost } from "./providers.js";

export const DEFAULT_TEXT_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
/** Llama 4 Scout reads images with no extra license step on the account (Llama 3.2 Vision needs one). */
export const DEFAULT_VISION_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
export const PHOTO_MAX_OUTPUT_TOKENS = 450;
export const WORKERS_AI_REST_HOST = "https://api.cloudflare.com";
export const COACH_CHAT_SYSTEM_PROMPT =
  "You are Grow Coach for Shroom Labs. Culinary home cultivation only. Never market, price, or coach the restricted/psilocybin pack. Use only the grounding JSON. Reply in plain, short prose. Do not use JSON or markdown tables. For temperature and humidity, use the selected profile's per-stage target and warning ranges from the grounding, not generic species lore. Compare current readings and setpoints to those stage targets and say plainly when they are out of range. Suggest setpoints only inside the provided safe bounds.";

export function createModelProvider(env, request) {
  if (env.AI && coachAiConfigured(env)) return workersAiProvider(env);
  if (coachLocalRestEnabled(env) && !isProdHost(request)) return workersAiProvider(env);
  if (devStubsEnabled(env, request)) return stubProvider();
  return disabledProvider();
}

export function workersAiRestUrl(accountId, model) {
  const account = encodeURIComponent(String(accountId || "").trim());
  const path = String(model || "").replace(/^\/+/, "");
  return `${WORKERS_AI_REST_HOST}/client/v4/accounts/${account}/ai/run/${path}`;
}

/** Cloudflare wraps model output as { success, result }. Accept unwrapped mocks too. */
export function unwrapWorkersAiBody(body) {
  if (body == null) return {};
  if (typeof body === "string") return { response: body };
  if (body.result != null && body.response == null && body.choices == null) {
    return typeof body.result === "string" ? { response: body.result, usage: body.usage } : body.result;
  }
  return body;
}

export async function workersAiRestRun(env, model, input) {
  const account = String(env.CF_ACCOUNT_ID || "").trim();
  const token = String(env.WORKERS_AI_TOKEN || "").trim();
  const fetchImpl = env.fetch || globalThis.fetch;
  const res = await fetchImpl(workersAiRestUrl(account, model), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Workers AI REST ${res.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }
  return unwrapWorkersAiBody(await res.json());
}

/** Qwen3 may wrap chain-of-thought in <think>…</think>. Never return or store it. */
export function stripThinkTags(text) {
  return String(text ?? "")
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s+|\s+$/g, "");
}

function choiceContent(choice) {
  if (!choice) return "";
  const content = choice.message?.content ?? choice.delta?.content ?? choice.text ?? "";
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || part?.content || ""))
      .join("");
  }
  return content;
}

/** Workers AI may return OpenAI-style choices or a top-level `response` field. */
export function workersAiText(result) {
  const raw =
    choiceContent(result?.choices?.[0]) ||
    result?.response ||
    result?.result ||
    result?.text ||
    "";
  return stripThinkTags(raw);
}

function disabledProvider() {
  return {
    name: "disabled",
    async chat() {
      return { unavailable: true, ...comingSoonBody("Grow Coach") };
    },
    async photoCheck() {
      return { unavailable: true, ...comingSoonBody("Grow Coach") };
    },
  };
}

function stubProvider() {
  return {
    name: "stub",
    async chat({ message, grounding }) {
      const text = String(message || "");
      const device = grounding.device_model || {};
      const reply = [
        "Grow Coach (stub, no live model). Culinary cultivation only.",
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
    async photoCheck({ context }) {
      const note = String(context?.grower_note || "").toLowerCase();
      const issues = [];
      if (/mold|green|trich|contam/.test(note)) {
        issues.push({ label: "Possible mold", detail: "There is a green patch on the block.", severity: "high" });
      }
      if (/dry|cracked|shrivel/.test(note)) {
        issues.push({ label: "Block looks dry", detail: "The surface looks cracked.", severity: "medium" });
      }
      const stage = /fruit|cap/.test(note) ? "fruiting" : /pin/.test(note) ? "pinning" : "colonizing";
      const steps = issues.some((i) => i.severity === "high")
        ? ["Isolate the block.", "Do not fan air toward other chambers.", "Throw it out if the spot spreads."]
        : ["Keep humidity in the target band.", "Look again in 24 hours."];
      const chamber = context?.chamber;
      const summary = chamber?.now
        ? `Stub check. ${chamber.name} reads ${chamber.now.humidity_percent}% humidity.`
        : "Stub check. No live model is connected.";
      if (/psilocyb|cubensis/.test(note)) return { text: JSON.stringify({ off_topic: true }), usage: { prompt_tokens: 1000, completion_tokens: 10 } };
      return {
        text: JSON.stringify({ off_topic: false, summary, stage, issues, next_steps: steps, confidence: issues.length ? 0.78 : 0.55 }),
        usage: { prompt_tokens: 1070, completion_tokens: 100, neurons: 34 },
        model: "stub",
      };
    },
  };
}

async function runWorkersAi(env, model, input) {
  if (env.AI) return env.AI.run(model, input);
  return workersAiRestRun(env, model, input);
}

function workersAiProvider(env) {
  const textModel = env.GROW_COACH_TEXT_MODEL || DEFAULT_TEXT_MODEL;
  const visionModel = env.GROW_COACH_VISION_MODEL || DEFAULT_VISION_MODEL;
  const viaRest = !env.AI && coachLocalRestEnabled(env);
  return {
    name: viaRest ? "workers-ai-rest" : "workers-ai",
    async chat({ message, grounding }) {
      const system = COACH_CHAT_SYSTEM_PROMPT;
      const result = await runWorkersAi(env, textModel, {
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Grounding:\n${JSON.stringify(grounding)}\n\nQuestion: ${message}` },
        ],
      });
      const text = workersAiText(result);
      return {
        text,
        input_tokens: result.usage?.prompt_tokens || result.usage?.input_tokens || 800,
        output_tokens: result.usage?.completion_tokens || result.usage?.output_tokens || 200,
        cached: false,
        model: textModel,
      };
    },
    async photoCheck({ imageBase64, contentType, system, context }) {
      const prompt = context
        ? `Grow context JSON:\n${JSON.stringify(context)}\n\nLook at the photo and reply with the JSON object only.`
        : "No chamber or profile was picked. Look at the photo and reply with the JSON object only.";
      const result = await runWorkersAi(env, visionModel, {
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${contentType || "image/jpeg"};base64,${imageBase64}` } },
            ],
          },
        ],
        max_tokens: PHOTO_MAX_OUTPUT_TOKENS,
        temperature: 0.2,
      });
      return { text: workersAiText(result), usage: result.usage || {}, model: visionModel };
    },
  };
}
