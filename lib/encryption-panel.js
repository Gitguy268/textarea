// The encryption panel.
//
// Encryption here means the URL, not a file: the note is encrypted with AES-256
// and the hash holds only ciphertext, so the address bar stops revealing it. The
// export panel writes encrypted archives instead, which is a different feature
// with a different format.
//
// The two actions live behind one menu entry because they are the same switch
// seen from either side. Showing "Remove encryption" as its own row in the menu
// meant a row that was hidden most of the time and a row that was the only way
// out of a state you could get into by accident.

/**
 * Offer the two things that can be done to a note's encryption.
 *
 * @param {object} options
 * @param {boolean} options.encrypted  whether the hash currently holds ciphertext
 * @param {() => void | Promise<void>} options.onEncrypt
 * @param {() => void | Promise<void>} options.onDecrypt
 * @returns {Promise<'encrypt'|'decrypt'|null>} what was chosen, or null if dismissed
 */
export async function showEncryptionPanel({encrypted, onEncrypt, onDecrypt} = {}) {
  const dialog = document.createElement('dialog')
  dialog.className = 'dialog dialog-encryption'
  dialog.setAttribute('aria-label', 'Encryption')

  const form = document.createElement('form')
  form.method = 'dialog'
  form.className = 'dialog-form'

  const heading = document.createElement('h2')
  heading.className = 'dialog-title'
  heading.textContent = 'Encryption'
  form.append(heading)

  const description = document.createElement('p')
  description.className = 'dialog-description'
  description.textContent = encrypted
    ? 'The note is encrypted in the URL. Editing it does not change the link, so what you shared stays as you shared it.'
    : 'Encrypt the note in the URL with a password, so the address bar stops revealing what it says.'
  form.append(description)

  const note = document.createElement('p')
  note.className = 'dialog-note'
  note.textContent =
    'The password is never stored. Anyone with both the link and the password can read the note, and a lost password cannot be recovered.'
  form.append(note)

  const actions = document.createElement('div')
  actions.className = 'dialog-actions'

  // Escape and a backdrop click would dismiss it, but a reader who opened a
  // two-button panel and wants neither should not have to know that.
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.className = 'dialog-button'
  cancel.textContent = 'Cancel'

  const encrypt = document.createElement('button')
  encrypt.type = 'button'
  encrypt.className = 'dialog-button'
  encrypt.disabled = encrypted
  encrypt.textContent = encrypted ? 'Encrypted link: on' : 'Encrypted link'

  const decrypt = document.createElement('button')
  decrypt.type = 'button'
  // Only styled as destructive when it can actually do something. A large red
  // button that cannot be pressed is the wrong signal twice over.
  decrypt.className = 'dialog-button' + (encrypted ? ' dialog-button-danger' : '')
  decrypt.disabled = !encrypted
  decrypt.textContent = 'Remove encryption'

  actions.append(cancel, encrypt, decrypt)
  form.append(actions)
  dialog.append(form)

  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      dialog.close()
      dialog.remove()
      resolve(value)
    }

    cancel.addEventListener('click', () => finish(null))

    // Both handlers run after the panel is gone, so a password prompt stacked on
    // top of this one cannot appear behind it.
    encrypt.addEventListener('click', () => {
      finish('encrypt')
      onEncrypt?.()
    })
    decrypt.addEventListener('click', () => {
      finish('decrypt')
      onDecrypt?.()
    })
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      finish(null)
    })
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(null)
    })

    document.body.append(dialog)
    dialog.showModal()
    ;(encrypted ? decrypt : encrypt).focus()
  })
}
