// Choosing in a UEP Select from a test: what userEvent.selectOptions did for
// a native <select>. Opens the combobox and clicks the option whose value or
// visible text is `wanted`.
import { act, fireEvent } from '@testing-library/react'

export async function pickOption(combobox, wanted) {
  const trigger = await combobox
  await act(async () => {
    fireEvent.click(trigger)
  })
  const listId = trigger.getAttribute('aria-controls')
  const list = document.getElementById(listId)
  if (!list) throw new Error('The select did not open')
  const options = [...list.querySelectorAll('[role="option"]')]
  const option =
    options.find((o) => o.dataset.value === String(wanted)) ??
    options.find((o) => o.textContent.trim() === String(wanted))
  if (!option) throw new Error(`No option "${wanted}" in ${options.map((o) => o.textContent).join(', ')}`)
  await act(async () => {
    fireEvent.click(option)
  })
}
