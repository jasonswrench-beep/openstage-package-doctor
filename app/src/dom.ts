// Small helpers the report and the test player share: making elements, and drawing a finding.

import { SEVERITY_WORDS, type Finding, type Severity } from "../../core/src/findings.ts";
import { icon, type IconName } from "./icons.ts";

export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string | boolean> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false) continue;
    if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const BADGE_ICON: Record<Severity, IconName> = { problem: "problem", warning: "warning", note: "note" };

export function badge(severity: Severity): HTMLElement {
  return h("span", { class: `badge badge--${severity}` }, icon(BADGE_ICON[severity]), SEVERITY_WORDS[severity]);
}

/** One finding: its title as a heading at the given level, what was found, where, and what to do. */
export function findingItem(f: Finding, level: "h3" | "h4" = "h4"): HTMLElement {
  return h(
    "li",
    { class: `finding finding--${f.severity}` },
    h(level, {}, f.title),
    h("p", {}, f.detail),
    f.file ? h("p", { class: "where" }, "In ", h("code", {}, f.file), f.line ? `, line ${f.line}` : "") : null,
    h("p", { class: "fix" }, h("strong", {}, "What to do: "), f.fix),
    h("p", { class: "check-id" }, `Check: ${f.id}`),
  );
}

/**
 * Asks a question that needs an answer before going on, in a modal box: its heading is the question, focus starts on
 * the safe answer (`no`), stays inside the box, and Escape means no. Focus goes back where it was. Resolves true for yes.
 */
export function ask(question: string, detail: string, yes: string, no: string): Promise<boolean> {
  return new Promise((resolve) => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const yesButton = h("button", { type: "button", class: "button button--primary" }, yes);
    const noButton = h("button", { type: "button", class: "button" }, no);
    const box = h("dialog", { class: "ask", "aria-labelledby": "ask-question", "aria-describedby": "ask-detail" }, h("h2", { id: "ask-question" }, question), h("p", { id: "ask-detail" }, detail), h("div", { class: "play-start" }, noButton, yesButton));
    const done = (answer: boolean) => {
      box.close();
      box.remove();
      before?.focus();
      resolve(answer);
    };
    yesButton.addEventListener("click", () => done(true));
    noButton.addEventListener("click", () => done(false));
    box.addEventListener("cancel", (e) => {
      e.preventDefault();
      done(false);
    });
    document.body.append(box);
    box.showModal();
    noButton.focus();
  });
}

/** Puts text on the clipboard, with the old way as a fallback for a window that refuses the new one. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = h("textarea", { class: "visually-hidden", "aria-hidden": "true" });
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}
