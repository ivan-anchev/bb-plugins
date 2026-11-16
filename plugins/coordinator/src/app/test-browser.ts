// Tests only: the app's components run as in bb's panel. A browser window, and its globals, for
// React's DOM renderer, which looks for them as it loads, so import this first; and .tsx modules,
// which node can't load itself, compiled as `bb plugin build` compiles them. Import a component
// dynamically, after this, since a static import is loaded before any module runs.
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import ts from "typescript";

const { window } = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });

// why every name the window has and node lacks: components reach the browser through globals
// (window, document, localStorage, HTMLElement, getComputedStyle…), as they do in bb.
for (const name of Object.getOwnPropertyNames(window)) {
  if (name in globalThis) continue;
  Object.defineProperty(globalThis, name, { configurable: true, get: () => window[name as keyof typeof window] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".tsx")) return nextLoad(url, context);
    const fileName = fileURLToPath(url);
    const { outputText } = ts.transpileModule(readFileSync(fileName, "utf8"), {
      fileName,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  },
});
