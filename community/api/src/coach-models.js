/** Swappable model providers. Workers AI binding in prod; REST only when ENVIRONMENT=local. */

import { coachAiConfigured, coachLocalRestEnabled, comingSoonBody, devStubsEnabled, isProdHost } from "./providers.js";

export const DEFAULT_TEXT_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
export const DEFAULT_VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
export const WORKERS_AI_REST_HOST = "https://api.cloudflare.com";
export const COACH_CHAT_SYSTEM_PROMPT =
  "You are Grow Coach for Shroom Labs. Culinary home cultivation only. Never market, price, or coach the restricted/psilocybin pack. Use only the grounding JSON. Reply in plain, short prose. Do not use JSON or markdown tables. For temperature and humidity, use the selected profile's per-stage target and warning ranges from the grounding, not generic species lore. Suggest setpoints only inside the provided safe bounds.";

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
    async vision() {
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
    async vision({ imageBase64, hint }) {
      const result = await runWorkersAi(env, visionModel, {
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
      const raw = workersAiText(result);
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
