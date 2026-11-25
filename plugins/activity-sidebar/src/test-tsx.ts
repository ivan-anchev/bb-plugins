// Tests only: lets node load the app's .tsx modules, compiled as `bb plugin build` compiles them, with
// the constant its build defines.
// Import it first, then import a component dynamically: a static import loads before any module runs.
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// why: bb's build defines the plugin's id as this constant (portal-scope.ts reads it).
Object.assign(globalThis, { __BB_PLUGIN_ID__: "activity-sidebar" });

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
