import { Fragment } from 'react'
import { metaParts } from '../lib/joinMeta'

/** Nodes joined by " · ", with a separator only between present parts. */
export default function MetaLine({ parts }) {
  return metaParts(parts).map((part, i) => (
    <Fragment key={i}>
      {i > 0 && ' · '}
      {part}
    </Fragment>
  ))
}
