/**
 * The date rule (UEP-13 §3.7), read from one place so it can become a tenant
 * setting later (no settings UI yet):
 *
 * - day dates are Gregorian, English, Latin digits: "2 Sept 2026";
 * - monthly periods are Shamsi, Persian digits, Vazirmatn: "مهر ۱۴۰۵";
 * - time of day is Latin digits, 24 h: "12:24".
 *
 * A string never mixes Latin and Persian digits.
 */
export const DATE_RULE = Object.freeze({
  dayCalendar: 'gregorian',
  periodCalendar: 'shamsi',
  /** The calendar a date picker opens on, by what the date is. */
  pickerCalendar: (kind) => (kind === 'letter' ? 'shamsi' : 'gregorian'),
})

export const usesShamsiDays = () => DATE_RULE.dayCalendar === 'shamsi'
