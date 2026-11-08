// The URL that serves an image committed to a GitHub repo, for an image's source.
// why: authors link screenshots committed to the repo as `github.com/<o>/<r>/blob/<ref>/<path>?raw=true`
// or `github.com/<o>/<r>/raw/<ref>/<path>`. GitHub's page shows them through its image proxy, but a
// browser fetching them directly is redirected to `/raw/` and gets a 504, so bb drew a broken image.
// `raw.githubusercontent.com` serves the same bytes for a public repo. A private repo's files need
// a token there too, so its images stay broken. Every other URL is returned as it is.

const GITHUB_FILE = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(?:blob\/([^?#\s]+)\?raw=true|raw\/([^?#\s]+))$/;

export function directImageUrl(url: string): string {
  const file = GITHUB_FILE.exec(url);
  if (file === null) return url;
  const [, owner, repo, blobPath, rawPath] = file;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${blobPath ?? rawPath}`;
}
