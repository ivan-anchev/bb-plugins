import { directImageUrl } from "./github-image-urls.ts";

export function directImages(element: HTMLElement): () => void {
  const repoint = () => element.querySelectorAll("img").forEach(repointImage);
  repoint();
  const observer = new MutationObserver(repoint);
  observer.observe(element, { childList: true, subtree: true, attributeFilter: ["src"] });
  return () => observer.disconnect();
}

function repointImage(image: HTMLImageElement) {
  const direct = directImageUrl(image.src);
  if (direct !== image.src) image.src = direct;
}
