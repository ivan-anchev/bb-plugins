const GITHUB_FILE = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(?:blob\/([^?#\s]+)\?raw=true|raw\/([^?#\s]+))$/;

export function directImageUrl(url: string): string {
  const file = GITHUB_FILE.exec(url);
  if (file === null) return url;
  const [, owner, repo, blobPath, rawPath] = file;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${blobPath ?? rawPath}`;
}
