// Digits as people read them, and as the system stores them.
//
// Shamsi dates and letter numbers are shown in Persian digits (۱۴۰۵/۰۴/۱۱)
// and stored, validated and sent in Latin digits (1405/04/11). An input shows
// Persian, accepts Persian, Arabic-Indic or Latin from the keyboard or a
// paste, and hands Latin to its owner. The server's twin is
// backend/app/core/digits.py; both are tested against digitVectors.json.

const PERSIAN = '۰۱۲۳۴۵۶۷۸۹'
const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩'

/** `text` with every Persian or Arabic-Indic digit made Latin. */
export function toLatinDigits(text) {
  return String(text ?? '')
    .replace(/[۰-۹]/g, (d) => String(PERSIAN.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
}

/** `text` with every Latin digit shown as a Persian one. */
export function toPersianDigits(text) {
  return String(text ?? '').replace(/[0-9]/g, (d) => PERSIAN[d])
}
