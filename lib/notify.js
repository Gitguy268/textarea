// The notification bubble: one line of feedback, bottom of the page.

const notification = document.querySelector('#notification')

/**
 * Every message the bubble shows gets a sequence number. Progress updates and
 * results both bump it, which is what lets the tests wait for the outcome rather
 * than for a fixed delay.
 */
let notificationSequence = 0

export function showBusy(message) {
  notification.setAttribute('aria-live', 'polite')
  notification.textContent = message
  notification.dataset.sequence = String(++notificationSequence)
  notification.classList.add('visible', 'busy')
  clearTimeout(showBusy.timer)
  showBusy.timer = setTimeout(() => notification.classList.remove('visible'), 8000)
}

export function notify(message, {error = false, duration = 2000} = {}) {
  clearTimeout(showBusy.timer)
  // Set before the text changes: a live region announces the mutation, so the
  // politeness has to already be right when the message lands.
  notification.setAttribute('aria-live', error ? 'assertive' : 'polite')
  notification.textContent = message
  notification.dataset.sequence = String(++notificationSequence)
  notification.classList.toggle('error', error)
  notification.classList.remove('busy')
  notification.classList.add('visible')
  setTimeout(() => notification.classList.remove('visible'), duration)
}
