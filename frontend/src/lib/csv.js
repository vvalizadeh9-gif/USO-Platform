// A list on screen as a CSV file, for the work pages' Export button.
//
// UTF-8 with a byte-order mark, so Excel opens Persian names correctly, and
// every cell quoted, so a comma or a line break in a field note stays in its
// cell.
import { saveBlob } from './download'

const BOM = String.fromCharCode(0xfeff)

const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`

/** @param {{ label: string, value: (row: any) => unknown }[]} columns */
export function toCsv(columns, rows) {
  const lines = [columns.map((c) => quote(c.label)).join(',')]
  for (const row of rows) lines.push(columns.map((c) => quote(c.value(row))).join(','))
  return `${BOM}${lines.join('\r\n')}\r\n`
}

export function downloadCsv(filename, columns, rows) {
  saveBlob(new Blob([toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' }), filename)
}
