import { GoogleGenAI, type Content } from "@google/genai";
import { PACING } from "@/lib/arena/pacing";
import {
  SYSTEM_INSTRUCTION,
  buildUserPrompt,
  pickBusiness,
  scenarioResponseSchema,
  validateScenario,
  type Scenario,
  type ScenarioRequest,
} from "./spec";

export const GENERATION_MODEL = "gemini-2.5-flash";
const MAX_TRIES = 3;

// Created on first use so `next build` doesn't need the key.
let ai: GoogleGenAI | undefined;

export class ScenarioGenerationError extends Error {
  constructor(
    message: string,
    readonly lastErrors: string[],
  ) {
    super(message);
  }
}

export async function generateScenario(req: ScenarioRequest, signal?: AbortSignal) {
  ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const started = Date.now();
  const pacing = PACING[req.pacing];

  // Multi-turn repair: on a bad answer we send back the model's own output plus
  // the list of problems, which is cheaper and more reliable than regenerating.
  const contents: Content[] = [{ role: "user", parts: [{ text: buildUserPrompt(req, pickBusiness()) }] }];
  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const response = await ai.models.generateContent({
      model: GENERATION_MODEL,
      contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: scenarioResponseSchema,
        temperature: 1,
        // Thinking lets the model plan the severity mix and line numbers before writing.
        thinkingConfig: { thinkingBudget: 6144 },
        maxOutputTokens: 40_000, // includes thinking tokens on 2.5 models
        abortSignal: signal,
      },
    });

    const text = response.text ?? "";
    let raw: unknown;
    try {
      raw = JSON.parse(text);
      const result = validateScenario(raw, pacing);
      if (result.ok) {
        return { scenario: result.scenario satisfies Scenario, tries: attempt, ms: Date.now() - started };
      }
      lastErrors = result.errors;
    } catch {
      lastErrors = [`Response was not valid JSON (finishReason: ${response.candidates?.[0]?.finishReason ?? "unknown"}).`];
    }

    contents.push(
      { role: "model", parts: [{ text }] },
      {
        role: "user",
        parts: [
          {
            text: `Your scenario was rejected. Fix ONLY these problems and return the complete corrected JSON:\n- ${lastErrors.join("\n- ")}`,
          },
        ],
      },
    );
  }

  throw new ScenarioGenerationError(`Scenario failed validation after ${MAX_TRIES} attempts`, lastErrors);
}
