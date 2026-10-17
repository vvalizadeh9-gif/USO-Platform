import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/client', () => ({ default: { post: vi.fn(() => Promise.resolve()) } }))
import api from '../api/client'
import ErrorBoundary, { CardBoundary, newErrorId } from './ErrorBoundary'

function Boom() {
  throw new Error('boom')
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    api.post.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('makes an ID of six hex characters', () => {
    expect(newErrorId()).toMatch(/^UEP-[0-9A-F]{6}$/)
  })

  it('renders the page fallback and posts the error once', () => {
    render(
      <ErrorBoundary level="page" resetKey="/a">
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('This page couldn’t load')).toBeInTheDocument()
    expect(screen.getByText(/UEP-[0-9A-F]{6}/)).toBeInTheDocument()
    expect(api.post).toHaveBeenCalledTimes(1)
    expect(api.post.mock.calls[0][0]).toBe('/client-errors')
  })

  it('resets when the route changes', () => {
    const { rerender } = render(
      <ErrorBoundary level="page" resetKey="/a">
        <Boom />
      </ErrorBoundary>,
    )
    rerender(
      <ErrorBoundary level="page" resetKey="/b">
        <p>fine</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('fine')).toBeInTheDocument()
  })

  it('keeps a card header and retries', () => {
    let fail = true
    function Flaky() {
      if (fail) throw new Error('x')
      return <p>loaded</p>
    }
    render(
      <CardBoundary title="Totals">
        <Flaky />
      </CardBoundary>,
    )
    expect(screen.getByText('Totals')).toBeInTheDocument()
    expect(screen.getByText('Couldn’t load this card')).toBeInTheDocument()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(screen.getByText('loaded')).toBeInTheDocument()
  })
})
