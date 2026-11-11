import { GoogleGenAI } from "@google/genai";

// Free tier. gemini-2.5-flash is deprecated and closed to new API keys.
export const GEMINI_MODEL = "gemini-3.5-flash-lite";

// Created on first use so `next build` doesn't need the key.
let client: GoogleGenAI | undefined;

export function gemini(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}
