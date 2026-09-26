import api from '../../api/client'

/** The file name the server put in Content-Disposition, if any. */
export function filenameFrom(disposition) {
  const match = /filename="([^"]+)"/.exec(disposition || '')
  return match ? match[1] : null
}

/**
 * Fetch a workbook and hand it to the browser as a download.
 *
 * Shared by the scorecard and the Monthly Plan page so both save the file the
 * same way. Throws on failure; the caller says so in its own words.
 */
export async function downloadXlsx(url, params, fallbackName) {
  const r = await api.get(url, { params, responseType: 'blob' })
  const href = URL.createObjectURL(r.data)
  const link = document.createElement('a')
  link.href = href
  link.download = filenameFrom(r.headers['content-disposition']) || fallbackName
  link.click()
  URL.revokeObjectURL(href)
}
