/** The value `stored` holds, or undefined (which a schema rejects) when it is empty or malformed. */
export function parseJson(stored: string): unknown {
  try {
    return JSON.parse(stored);
  } catch {
    return undefined;
  }
}
