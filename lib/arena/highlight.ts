import { createHighlighter, type Highlighter } from "shiki";
import { LANGUAGES } from "@/lib/scenario/spec";

const THEME = "github-dark-default";

// Creating a highlighter loads grammars, so do it once per server instance.
let highlighter: Promise<Highlighter> | undefined;

export async function highlight(code: string, language: string): Promise<string> {
  highlighter ??= createHighlighter({ themes: [THEME], langs: [...LANGUAGES] });
  const h = await highlighter;
  const lang = (LANGUAGES as readonly string[]).includes(language) ? language : "text";
  return h.codeToHtml(code, { lang, theme: THEME });
}
