export function initialsOf(login: string): string {
  const words = login.split(/[-_.[\]]+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : login.slice(0, 2)).toUpperCase();
}
