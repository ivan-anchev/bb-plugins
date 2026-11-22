const HIDDEN_CHARACTERS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

export const stripHidden = (text: string) => text.replace(HIDDEN_CHARACTERS, "");

/** A path as a JSON string with hidden characters escaped. Lossless: JSON.parse gives back the exact path. */
export const pathLiteral = (path: string) =>
  JSON.stringify(path).replace(HIDDEN_CHARACTERS, (character) => `\\u${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
