// Tests only: the app's components in Chrome, for what only a browser's layout shows, such as where a
// cut text ends. A page module, which draws them (test-chrome-page.tsx), is built for the browser as
// bb's build builds the app, its stylesheets with it, and opened in the Chrome installed on the
// machine, as bb runs in Chromium; CI's runner has one too.
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Page } from "playwright-core";

/** Chrome with the page module at `entry` built: `open` shows it in a new page `width` pixels wide, drawn and settled; `close` quits Chrome. */
export async function chromeWith(entry: URL): Promise<{ open(width: number): Promise<Page>; close(): Promise<void> }> {
  const files = await pageFiles(entry);
  const browser = await chromium.launch({ channel: "chrome" });
  return {
    async open(width) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors: Error[] = [];
      page.on("pageerror", (error) => errors.push(error));
      await page.route(`${ORIGIN}/**`, (route) => route.fulfill(files[new URL(route.request().url()).pathname] ?? { status: 404 }));
      await page.goto(`${ORIGIN}/`);
      await settled(page);
      if (errors.length > 0) throw new AggregateError(errors, `the page at ${width}px failed as it drew`);
      return page;
    },
    close: () => browser.close(),
  };
}

/** Waits two frames: a cut is measured as its text lays out and again as its box resizes, which the browser reports by the next frame. */
export const settled = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

// ------------------------------------------------------------------ layer 2

/** Where the page is served from: a name no request leaves the browser for, since every one is answered here. */
const ORIGIN = "http://chrome.test";

/** The page, and its built script and stylesheet, by path. */
async function pageFiles(entry: URL): Promise<Record<string, { contentType: string; body: string }>> {
  const { outputFiles } = await build({ entryPoints: { page: fileURLToPath(entry) }, bundle: true, write: false, outdir: "/", format: "esm", platform: "browser", logLevel: "silent" });
  const built = outputFiles.map((file) => [file.path, { contentType: file.path.endsWith(".css") ? "text/css" : "text/javascript", body: file.text }]);
  return { "/": { contentType: "text/html", body: PAGE }, ...Object.fromEntries(built) };
}

/** The page: the built stylesheet and script, on a body set as bb's panel sets its text. */
const PAGE = `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="/page.css" />
    <style>body { margin: 0; padding: 12px; font: 13px/18px system-ui, sans-serif; }</style>
  </head>
  <body>
    <script type="module" src="/page.js"></script>
  </body>
</html>`;
