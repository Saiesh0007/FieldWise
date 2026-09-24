/**
 * Browser-only download/open helpers — thin wrappers around the Blob +
 * object-URL APIs, not pure logic, so they're deliberately not unit
 * tested here (there's nothing to assert against outside a real DOM);
 * the Playwright pass is what verifies a click actually triggers a
 * download / opens a tab.
 */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Give the download a moment to start before freeing the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Opens HTML content (the handoff sheet) in a new tab via an object URL, so it renders as a real page — including its own "Print" button — rather than a raw-text download. */
export function openHtmlInNewTab(html: string): void {
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
