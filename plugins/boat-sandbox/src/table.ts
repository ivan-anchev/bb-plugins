/** A plain table for the terminal: columns padded to their widest cell, the last one left ragged. */
export function formatTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const cells = [header, ...rows];
  const widths = header.map((_, column) => Math.max(...cells.map((line) => line[column].length)));
  const lines = cells.map((line) => line.map((cell, column) => (column === line.length - 1 ? cell : cell.padEnd(widths[column]))).join("  "));
  return `${lines.map((line) => line.trimEnd()).join("\n")}\n`;
}
