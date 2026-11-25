// Tests only: the app's components run as in bb's sidebar. A browser window and its globals, which
// React's DOM renderer looks for as it loads, so import this first; the constant bb's build defines;
// and .tsx modules, which node can't load itself, compiled as `bb plugin build` compiles them. Import
// a component dynamically, after this: a static import loads before any module runs.
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import ts from "typescript";

const { window } = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });

// why every name the window has and node lacks: components reach the browser through globals, as in bb.
for (const name of Object.getOwnPropertyNames(window)) {
  if (name in globalThis) continue;
  Object.defineProperty(globalThis, name, { configurable: true, get: () => window[name as keyof typeof window] });
}

// why: node has its own Event and CustomEvent, which jsdom's dispatchEvent refuses; menus (Radix) make theirs with the global ones.
for (const name of ["Event", "CustomEvent"] as const) {
  Object.defineProperty(globalThis, name, { configurable: true, get: () => window[name] });
}

// why: jsdom lays nothing out, so nothing resizes and nothing scrolls into view.
class StillResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: StillResizeObserver, __BB_PLUGIN_ID__: "activity-sidebar" });
window.Element.prototype.scrollIntoView = () => {};

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
