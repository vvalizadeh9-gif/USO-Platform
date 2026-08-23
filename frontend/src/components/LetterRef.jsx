// A letter number, rendered exactly as it was typed.
//
// Persian letter numbers mix Latin digits with an Arabic letter — "1404/ص/4471".
// Left to itself the browser applies the Unicode bidirectional algorithm: the
// Arabic letter starts a right-to-left run, and by rule W2 the digits after it
// are reclassified as Arabic numbers and join that run, so the string displays
// as "1404/4471/ص". That is correct for Arabic *prose* and wrong here — this is
// an opaque reference code that someone will read out over the phone, paste
// into an email, or search the physical file for. What they typed has to be
// what they see.
//
// `isolate-override` does both jobs: isolate keeps the code from disturbing the
// text around it, override pins every character into logical order.
export default function LetterRef({ value }) {
  if (!value) return <>—</>
  return (
    <span dir="ltr" style={{ unicodeBidi: 'isolate-override' }}>
      {value}
    </span>
  )
}
