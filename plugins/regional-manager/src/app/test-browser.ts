import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import ts from "typescript";

const { window } = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });

for (const name of Object.getOwnPropertyNames(window)) {
  if (name in globalThis) continue;
  Object.defineProperty(globalThis, name, { configurable: true, get: () => window[name as keyof typeof window] });
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
  matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
});
window.Element.prototype.scrollIntoView = () => {};
window.HTMLCanvasElement.prototype.getContext = () => null;

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) {
      assertScoped(fileURLToPath(url));
      return { format: "module", source: "", shortCircuit: true };
    }
    if (!url.endsWith(".tsx")) return nextLoad(url, context);
    const fileName = fileURLToPath(url);
    const { outputText } = ts.transpileModule(readFileSync(fileName, "utf8"), {
      fileName,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  },
});

function assertScoped(fileName: string): void {
  const css = readFileSync(fileName, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [...css.matchAll(/([^{}]+)\{/g)].flatMap(([, prelude = ""]) => (prelude.trim().startsWith("@") ? [] : prelude.split(",").map((selector) => selector.trim())));
  const bare = selectors.filter((selector) => !selector.includes(".rmi-"));
  if (selectors.length === 0 || bare.length > 0) throw new Error(`${fileName} must style only the plugin's own \`rmi-\` classes; it has ${selectors.length === 0 ? "no rules read" : bare.join(", ")}.`);
}
