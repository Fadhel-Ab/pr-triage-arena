import { ThinkingLevel, type Content } from "@google/genai";
import { PACING } from "@/lib/arena/pacing";
import { GEMINI_MODEL, gemini } from "@/lib/gemini";
import {
  SYSTEM_INSTRUCTION,
  buildUserPrompt,
  pickBusiness,
  scenarioResponseSchema,
  validateScenario,
  type Scenario,
  type ScenarioRequest,
} from "./spec";

export const GENERATION_MODEL = GEMINI_MODEL;
const MAX_TRIES = 3;

export class ScenarioGenerationError extends Error {
  constructor(
    message: string,
    readonly lastErrors: string[],
  ) {
    super(message);
  }
}

export async function generateScenario(req: ScenarioRequest, signal?: AbortSignal) {
  const started = Date.now();
  const pacing = PACING[req.pacing];

  // Multi-turn repair: on a bad answer we send back the model's own output plus
  // the list of problems, which is cheaper and more reliable than regenerating.
  const contents: Content[] = [{ role: "user", parts: [{ text: buildUserPrompt(req, pickBusiness()) }] }];
  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const response = await gemini().models.generateContent({
      model: GENERATION_MODEL,
      contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: scenarioResponseSchema,
        temperature: 1,
        // Flash-Lite defaults to MINIMAL thinking; MEDIUM lets it plan the severity mix
        // and line numbers before writing. Gemini 3 uses thinkingLevel, not thinkingBudget.
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        maxOutputTokens: 40_000, // includes thinking tokens
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
