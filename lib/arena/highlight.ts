import { createHighlighter, type Highlighter } from "shiki";
import { LANGUAGES } from "@/lib/scenario/spec";

const THEME = "github-dark-default";

// Creating a highlighter loads grammars, so do it once per server instance.
let highlighter: Promise<Highlighter> | undefined;

/** `markLines` are 1-based line numbers within `code` that get the `evidence` class. */
export async function highlight(code: string, language: string, markLines: number[] = []): Promise<string> {
  highlighter ??= createHighlighter({ themes: [THEME], langs: [...LANGUAGES] });
  const h = await highlighter;
  const lang = (LANGUAGES as readonly string[]).includes(language) ? language : "text";
  const marked = new Set(markLines);
  return h.codeToHtml(code, {
    lang,
    theme: THEME,
    transformers: [
      {
        line(node, line) {
          if (marked.has(line)) this.addClassToHast(node, "evidence");
        },
      },
    ],
  });
}
