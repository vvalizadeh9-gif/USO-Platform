import api from '../api/client'

/**
 * Submit a drive test (UEP-24 F3). With files, the date and the files go in
 * one multipart request, so a drive test never waits for review with nothing
 * attached; without files it is the JSON submission (a report link).
 */
export function submitDriveTest(workItemId, { execution_date: executionDate, report_link: reportLink, files } = {}) {
  if (files && files.length) {
    const form = new FormData()
    if (executionDate) form.append('execution_date', executionDate)
    if (reportLink) form.append('report_link', reportLink)
    for (const file of files) form.append('files', file)
    return api.post(`/work-items/${workItemId}/drive-test/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  }
  const body = { execution_date: executionDate }
  if (reportLink) body.report_link = reportLink
  return api.post(`/work-items/${workItemId}/drive-test`, body)
}
