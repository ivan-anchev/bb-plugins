import { createFileTreeIconResolver, getBuiltInSpriteSheet } from "@pierre/trees";

const ICON_SET = "complete";
const resolver = createFileTreeIconResolver({ set: ICON_SET });

let symbols: Map<string, string> | null = null;

export function FileIcon({ path }: { path: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="size-4 shrink-0 text-muted-foreground"
      dangerouslySetInnerHTML={{ __html: symbolOf(resolver.resolveIcon("file-tree-icon-file", path).name) }}
    />
  );
}

function symbolOf(name: string): string {
  symbols ??= parseSpriteSheet(getBuiltInSpriteSheet(ICON_SET));
  const markup = symbols.get(name);
  if (markup === undefined) throw new Error(`@pierre/trees has no icon named ${name}`);
  return markup;
}

function parseSpriteSheet(sheet: string): Map<string, string> {
  const sprite = new DOMParser().parseFromString(sheet, "text/html");
  return new Map(Array.from(sprite.querySelectorAll("symbol"), (symbol): [string, string] => [symbol.id, symbol.innerHTML]));
}
