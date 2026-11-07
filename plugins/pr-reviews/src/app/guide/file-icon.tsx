// A file-type icon from @pierre/trees, the set Code Explorer's tree draws, in one quiet colour.
//
// why copy the symbol's markup: the package draws an icon as `<use href="#name">` against a
// sprite sheet it injects into its own tree's shadow root, which this page does not have. Each
// symbol is drawn inline instead, from the package's own sprite sheet, so no global sprite or
// shared element ids are added to bb's page.
import { createFileTreeIconResolver, getBuiltInSpriteSheet } from "@pierre/trees";

const ICON_SET = "complete";
const resolver = createFileTreeIconResolver({ set: ICON_SET });

/** Each symbol's inner SVG by its id, parsed on first use. */
let symbols: Map<string, string> | null = null;

export function FileIcon({ path }: { path: string }) {
  return (
    <svg
      aria-hidden
      // Every file icon in the set is drawn on a 16 × 16 grid.
      viewBox="0 0 16 16"
      className="size-4 shrink-0 text-muted-foreground"
      // The package's own static SVG, never data from the PR.
      dangerouslySetInnerHTML={{ __html: symbolOf(resolver.resolveIcon("file-tree-icon-file", path).name) }}
    />
  );
}

// why throw: the resolver only names symbols from this same sheet, so a miss is a package bug.
function symbolOf(name: string): string {
  symbols ??= parseSpriteSheet(getBuiltInSpriteSheet(ICON_SET));
  const markup = symbols.get(name);
  if (markup === undefined) throw new Error(`@pierre/trees has no icon named ${name}`);
  return markup;
}

// As HTML: the sheet is inline-SVG markup with a bare `data-icon-sprite` attribute, which XML rejects.
function parseSpriteSheet(sheet: string): Map<string, string> {
  const sprite = new DOMParser().parseFromString(sheet, "text/html");
  return new Map(Array.from(sprite.querySelectorAll("symbol"), (symbol): [string, string] => [symbol.id, symbol.innerHTML]));
}
