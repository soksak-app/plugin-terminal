// Builds the `screen` message of core (docs/spec/terminal-runtime.md#screen-message) from the compact form that the tests write:
// `lines` holds a string or a row of `{ ch, width, link }` per row, and `sequence`, `segment`, `rows`, `cols` and `cursor` are
// filled in when absent.
const DEFAULT_CURSOR = { visible: false, row: 0, col: 0, focused: false, shape: "Block", blinking: false };

export function screenMessage(compact) {
  if (compact.event !== "screen" || !Array.isArray(compact.lines)) return compact;
  const { lines, ...rest } = compact;
  const rowsOfCells = lines.map((line) => (typeof line === "string"
    ? [...line].map((ch) => ({ ch, width: 1 }))
    : line));
  const cursor = rest.cursor ?? DEFAULT_CURSOR;
  const cols = rest.cols ?? Math.max(1, (Number.isInteger(cursor.col) ? cursor.col + 1 : 1), ...rowsOfCells.map((row) => row.length));
  const rows = rest.rows ?? Math.max(1, (Number.isInteger(cursor.row) ? cursor.row + 1 : 1), rowsOfCells.length);
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cell = rowsOfCells[row]?.[col];
      cells.push({
        grapheme: cell?.ch ?? "", width: cell?.width ?? 1, fg: null, bg: null, attributes: 0,
        ...(cell?.link === undefined ? {} : { link: cell.link }),
      });
    }
  }
  return { sequence: 1, segment: "b1", ...rest, rows, cols, cursor, cells };
}
