// Points every image bb draws inside an element at a URL that serves the file itself, as a ref
// callback: `<section ref={directImages}>`.
//
// why the drawn images, not the markdown: bb's `Markdown` takes no hook for image URLs, and only its
// parser knows which text is an image: `![a](url)`, `![a][ref]`, a destination with parentheses, an
// HTML `<img>`, but not a URL in code or in an attribute. So bb parses, and this repoints the `img`
// elements it made. bb loads them lazily, and a ref runs in the same commit that adds them, so the
// first fetch already goes to the new URL. bb's lightbox reads the drawn `src`, so it shows the same.
// A refresh can add images or set a `src` back, so it watches for both.
import { directImageUrl } from "./github-image-urls.ts";

export function directImages(element: HTMLElement): () => void {
  const repoint = () => element.querySelectorAll("img").forEach(repointImage);
  repoint();
  const observer = new MutationObserver(repoint);
  observer.observe(element, { childList: true, subtree: true, attributeFilter: ["src"] });
  return () => observer.disconnect();
}

// Leaving a direct URL alone is what ends the loop: setting `src` notifies the observer once more.
function repointImage(image: HTMLImageElement) {
  const direct = directImageUrl(image.src);
  if (direct !== image.src) image.src = direct;
}
