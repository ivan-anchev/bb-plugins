// POSIX shell quoting for commands the plugin sends to a sandbox or prints for the user to run.

/** One word in single quotes, so the shell takes it literally. */
export const shellQuote = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`;

/** Every word quoted, so core's multi-line script reaches the shell unchanged. */
export const shellQuoteArgv = (argv: readonly string[]): string => argv.map(shellQuote).join(" ");
