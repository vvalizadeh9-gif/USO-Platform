// Saving a file the API generated, and explaining it when that fails.
//
// Two screens ask for a spreadsheet and both had the same two bugs, so the
// code lives here once rather than twice.
//
// THE DOWNLOAD ITSELF. The pattern everyone writes — create an anchor, set
// `download`, click it — has two sharp edges that Chrome happens to forgive
// and other browsers do not. An anchor that is not in the document is not
// guaranteed to be actionable, so Firefox ignores the click; and revoking the
// object URL on the next line can pull the blob out from under a download the
// browser has not started yet. The result is a button that works for whoever
// wrote it and silently does nothing for a third of the people using it.
//
// THE ERROR. `responseType: 'blob'` applies to the failure as well as the
// success, so a 400 that carries a perfectly good explanation arrives as a
// Blob and every `err.response.data.detail` reads undefined. Both screens
// therefore showed one sentence — "Could not generate the file. Please try
// again." — for a row-cap refusal, an expired session, a timeout and a
// server fault alike, which tells the reader nothing and tells whoever they
// report it to even less. `describeBlobError` reads the body back so the
// message says what actually happened.

/** Save `blob` as `filename`, in a way every browser actually honours. */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  // In the document, because a detached anchor's click is not dependable, and
  // removed straight after so a failed download does not leave litter behind.
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Deferred: revoking synchronously can cancel a download that has not begun.
  // The delay is a browser-behaviour allowance, not a guess at how long the
  // save takes — the blob is already in memory and the handle is all this is
  // keeping alive.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** The filename the server named the file, or `fallback`.
 *
 * `content-disposition` is not always readable — a proxy can strip it, and a
 * cross-origin response without `Access-Control-Expose-Headers` hides it — so
 * no caller depends on it being there. Where it is readable it wins: the
 * backend already builds a dated, scope-named, ASCII-safe name, and inventing
 * a second one in the browser is how the two come to disagree.
 */
export function filenameFrom(headers, fallback) {
  const disposition = headers?.['content-disposition'] ?? ''
  const quoted = /filename="([^"]+)"/.exec(disposition)
  if (quoted) return quoted[1]
  const bare = /filename=([^;]+)/.exec(disposition)
  if (bare) return bare[1].trim()
  return fallback
}

/** What went wrong with a request made with `responseType: 'blob'`.
 *
 * Returns a sentence to show the reader. The status is included because it is
 * the one thing that makes a report actionable without a screen share: a 404
 * is a backend older than this page, a 400 is a refusal with a reason, a 502
 * or 504 is the request taking longer than something in front of the server
 * was willing to wait — and those are three different fixes.
 */
export async function describeBlobError(err, fallback = 'Could not generate the file.') {
  const status = err?.response?.status
  if (!status) {
    // No response at all: the request never completed. Worth saying plainly,
    // because "try again" is genuinely the right advice here and nowhere else.
    return 'The server could not be reached. Check your connection and try again.'
  }

  const detail = await readDetail(err?.response?.data)
  if (detail) return `${detail} (${status})`

  if (status === 401 || status === 403) {
    return `You are not signed in, or may not export this. (${status})`
  }
  if (status === 404) {
    // Worth naming, because it is not a fault the reader can do anything
    // about and it has one usual cause.
    return `This export is not available on the server this page is talking to. (404)`
  }
  if (status === 502 || status === 503 || status === 504) {
    return `The file took too long to build. Narrow to one province and try again. (${status})`
  }
  return `${fallback} (${status})`
}

/** A Blob's contents as text, whichever way this browser offers.
 *
 * `Blob.prototype.text()` is the modern spelling and is missing from Safari
 * before 14 — and from jsdom, which is how the tests found it. FileReader is
 * the older one and is everywhere. Without the fallback this returns nothing
 * on exactly the browsers whose users are least likely to be able to explain
 * what they saw.
 */
function blobText(blob) {
  if (typeof blob?.text === 'function') return blob.text()
  if (typeof FileReader === 'undefined' || !(blob instanceof Blob)) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => resolve(null)
    reader.readAsText(blob)
  })
}

/** The `detail` out of an error body that arrived as a Blob, or null. */
async function readDetail(data) {
  try {
    const text = typeof data === 'string' ? data : await blobText(data)
    if (!text) return null
    const body = JSON.parse(text)
    const detail = body?.detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg
    if (detail?.message) return detail.message
    return null
  } catch {
    // A body that is not readable, or not JSON, is not an error in itself —
    // the caller still has the status to report.
    return null
  }
}
