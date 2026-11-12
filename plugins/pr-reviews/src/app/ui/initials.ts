// What an avatar shows when GitHub has no image for the login: the first letters of its first two
// words ("ivan-anchev" → "IA"), or its first two letters when it is one word ("dependabot" → "DE").
export function initialsOf(login: string): string {
  const words = login.split(/[-_.[\]]+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : login.slice(0, 2)).toUpperCase();
}
