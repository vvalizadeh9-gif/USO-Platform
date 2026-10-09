/** "Mina Rahimi" -> "MR": the first letter of the first two words. */
export function initialsOf(fullName) {
  return (fullName || 'U')
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}
