// A minimal .xlsx for the mocked export, and a row counter to read it back.
//
// The layout tests run without a backend, so the mock API has to hand the
// page a real spreadsheet when a number is clicked. This writes the smallest
// workbook Excel opens -- one sheet of inline strings -- in an uncompressed
// ("stored") zip, which also means the test can count its rows by reading
// the sheet XML straight out of the bytes.
import { crc32 } from 'node:zlib'

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

const escape = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function sheetXml(rows) {
  const body = rows
    .map(
      (cells, r) =>
        `<row r="${r + 1}">` +
        cells.map((value) => `<c t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join('') +
        '</row>'
    )
    .join('')
  return (
    XML +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${body}</sheetData></worksheet>`
  )
}

const PARTS = (rows) => ({
  '[Content_Types].xml':
    XML +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '</Types>',
  '_rels/.rels':
    XML +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>',
  'xl/workbook.xml':
    XML +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Villages" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':
    XML +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '</Relationships>',
  'xl/worksheets/sheet1.xml': sheetXml(rows),
})

/** A stored (uncompressed) zip of `files` ({ name: string }). */
function zip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name)
    const data = Buffer.from(text)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, data)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

/** A workbook with a header row and one row per village. */
export function villagesXlsx(count) {
  const rows = [['Village ID', 'Village name']]
  for (let i = 1; i <= count; i += 1) rows.push([`V-${i}`, `روستا ${i}`])
  return zip(PARTS(rows))
}

/** How many village rows a workbook written by `villagesXlsx` holds. */
export function countVillageRows(buffer) {
  const rows = buffer.toString('utf8').match(/<row r="/g) ?? []
  return rows.length - 1
}
