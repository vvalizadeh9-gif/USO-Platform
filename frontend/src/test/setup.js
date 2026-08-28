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
