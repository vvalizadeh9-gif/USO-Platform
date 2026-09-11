// Shared test setup.
//
// jest-dom adds the assertions that read like the thing being asserted --
// toBeInTheDocument, toHaveTextContent -- so a failure says what was wrong
// with the page rather than what was wrong with a DOM node.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Unmount between tests. Without this, a component from an earlier test is
// still in the document and queries match the wrong one -- which produces
// failures that look like bugs in the component under test.
afterEach(() => {
  cleanup()
  localStorage.clear()
})

// jsdom implements no matchMedia at all, and the Drive Test dashboard asks it
// whether the viewer prefers reduced motion. Answering "yes" does two things:
// counters and bars render at their final values on first paint, so a test can
// assert on a figure without waiting out an animation; and the reduced-motion
// path -- the one that has to be right for anyone who has asked their system
// for less movement -- is the path the suite actually exercises.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}
