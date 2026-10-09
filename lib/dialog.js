// Modal prompts, built on the native <dialog> element.
//
// Everything interactive that does not fit the three dot menu goes through here:
// the format picker, the password prompts, the ZIP options. <dialog> gives focus
// trapping, Escape to dismiss, inert background and a ::backdrop for free, which
// is why the project does not carry a dialog library.

import {trackGlass} from './glass.js'

/**
 * @typedef {object} DialogField
 * @property {string} name
 * @property {'text'|'password'|'textarea'|'radio'|'checkbox'|'select'|'note'} type
 * @property {string} label
 * @property {string} [description]
 * @property {string} [placeholder]
 * @property {string} [value]
 * @property {boolean} [checked]
 * @property {boolean} [disabled]
 * @property {Array<{value: string, label: string, icon?: string}>} [options]
 * @property {string} [icon]  a symbol id from index.html, for checkboxes
 * @property {boolean} [minLength]  passwords only: the shortest length accepted
 * @property {boolean} [confirm]  passwords only: ask for it twice
 * @property {string} [className]  extra classes on the field's group
 * @property {(values: Record<string, any>) => boolean} [when]
 *   show this field only while another answer says so. The export dialog uses it
 *   to swap the format list out for the QR code, which has no format.
 */

/**
 * Show a modal form.
 *
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.description]
 * @param {DialogField[]} options.fields
 * @param {string} [options.submitLabel]
 * @param {string} [options.cancelLabel]
 * @param {(values: Record<string, any>) => string | null} [options.validate]
 *   return an error message to keep the dialog open, or null to accept
 * @param {(values: Record<string, any>) => string} [options.submitLabelFor]
 *   name the submit button after the current answers, so "Copy" does not offer
 *   to write a file
 * @param {string} [options.className]  extra classes on the <dialog>, for sizing
 * @param {string} [options.danger]  style the submit button as destructive
 * @returns {Promise<Record<string, any> | null>} the field values, or null if dismissed
 */
export function showDialog(options) {
  const {
    title,
    description,
    fields,
    submitLabel = 'OK',
    submitLabelFor,
    cancelLabel = 'Cancel',
    validate,
    danger,
  } = options
  const dialog = document.createElement('dialog')
  dialog.className = 'dialog' + (options.className ? ' ' + options.className : '')
  dialog.setAttribute('aria-label', title)

  const form = document.createElement('form')
  form.method = 'dialog'
  form.className = 'dialog-form'

  const heading = document.createElement('h2')
  heading.className = 'dialog-title'
  heading.textContent = title
  form.append(heading)

  if (description) {
    const paragraph = document.createElement('p')
    paragraph.className = 'dialog-description'
    paragraph.textContent = description
    form.append(paragraph)
  }

  const error = document.createElement('p')
  error.className = 'dialog-error'
  error.setAttribute('role', 'alert')
  error.hidden = true
  form.append(error)

  const controls = new Map()
  // The group element for each field, so a field can be hidden once another
  // answer rules it out.
  const groups = []

  for (const field of fields) {
    const group = document.createElement('div')
    group.className = 'dialog-field dialog-field-' + field.type + (field.className ? ' ' + field.className : '')
    // Every branch below appends the group to the form, so recording it here
    // covers all of them at once.
    groups.push({group, field})

    if (field.type === 'note') {
      const note = document.createElement('p')
      note.className = 'dialog-note'
      note.textContent = field.label
      group.append(note)
      form.append(group)
      continue
    }

    if (field.type === 'checkbox') {
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.id = fieldId(field.name)
      input.name = field.name
      input.checked = field.checked === true
      input.disabled = field.disabled === true
      const label = document.createElement('label')
      label.htmlFor = input.id
      label.className = 'dialog-check'
      label.append(input)
      if (field.icon) label.append(icon(field.icon))
      label.append(document.createTextNode(field.label))
      group.append(label)
      controls.set(field.name, [input])
      form.append(group)
    } else if (field.type === 'radio' || field.type === 'select') {
      const list = document.createElement('div')
      list.className = 'dialog-choices'
      const inputs = []
      for (const [index, option] of (field.options ?? []).entries()) {
        const input = document.createElement('input')
        input.type = 'radio'
        input.name = field.name
        input.id = fieldId(field.name + (field.type === 'radio' ? '-' + index : ''))
        input.value = option.value
        input.checked = option.value === (field.value ?? field.options?.[0]?.value)
        input.disabled = field.disabled === true
        const label = document.createElement('label')
        label.htmlFor = input.id
        label.append(input)
        if (option.icon) label.append(icon(option.icon))
        label.append(document.createTextNode(option.label))
        list.append(label)
        inputs.push(input)
      }
      group.append(list)
      controls.set(field.name, inputs)
      form.append(group)
    } else {
      const input = document.createElement('input')
      input.type = field.type === 'password' ? 'password' : 'text'
      input.id = fieldId(field.name)
      input.name = field.name
      input.value = field.value ?? ''
      input.placeholder = field.placeholder ?? ''
      input.spellcheck = false
      input.autocomplete = field.type === 'password' ? 'new-password' : 'off'
      input.disabled = field.disabled === true
      input.dataset.role = field.type

      const label = document.createElement('label')
      label.htmlFor = input.id
      label.className = 'dialog-label'
      label.textContent = field.label
      group.append(label, input)

      if (field.type === 'password') {
        const toggle = document.createElement('button')
        toggle.type = 'button'
        toggle.className = 'dialog-reveal'
        toggle.textContent = 'Show'
        toggle.setAttribute('aria-label', 'Show the password')
        toggle.addEventListener('click', () => {
          const hidden = input.type === 'password'
          input.type = hidden ? 'text' : 'password'
          toggle.textContent = hidden ? 'Hide' : 'Show'
          toggle.setAttribute('aria-label', hidden ? 'Hide the password' : 'Show the password')
        })
        group.append(toggle)
        input.addEventListener('input', () => {
          if (field.minLength && input.value.length > 0 && input.value.length < field.minLength) {
            input.setCustomValidity(`Use at least ${field.minLength} characters`)
          } else {
            input.setCustomValidity('')
          }
        })
      }

      if (field.confirm) {
        const again = document.createElement('input')
        again.type = 'password'
        again.id = fieldId(field.name + '-confirm')
        again.name = field.name + 'Confirm'
        again.spellcheck = false
        again.autocomplete = 'new-password'
        again.placeholder = 'Repeat the password'
        again.setAttribute('aria-label', 'Repeat the password')
        group.append(again)
        controls.set(field.name + 'Confirm', [again])
      }

      controls.set(field.name, [input])
      form.append(group)
    }

    if (field.description) {
      const hint = document.createElement('p')
      hint.className = 'dialog-hint'
      hint.textContent = field.description
      group.append(hint)
    }
  }

  const actions = document.createElement('div')
  actions.className = 'dialog-actions'

  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.className = 'dialog-button'
  cancel.textContent = cancelLabel

  const submit = document.createElement('button')
  submit.type = 'submit'
  submit.className = 'dialog-button dialog-button-primary' + (danger ? ' dialog-button-danger' : '')
  submit.textContent = submitLabel

  actions.append(cancel, submit)
  form.append(actions)
  dialog.append(form)

  const readValues = () => {
    const values = {}
    for (const [name, inputs] of controls) {
      const input = inputs.find((candidate) => candidate.checked) ?? inputs[0]
      values[name] = input.type === 'checkbox' ? input.checked : input.value
    }
    return values
  }

  const showError = (message) => {
    error.textContent = message
    error.hidden = false
  }

  /**
   * Hide the fields whose `when` says no, and name the submit button after the
   * current answers. Runs on every answer rather than only on submit, because a
   * list of nine formats under a "QR code" choice is a question the dialog has
   * already answered wrongly.
   */
  const refresh = () => {
    const values = readValues()
    for (const {group, field} of groups) {
      if (field.when) group.hidden = !field.when(values)
    }
    if (submitLabelFor) submit.textContent = submitLabelFor(values)
  }

  /** The inputs of every field currently on show. */
  const visibleControls = () =>
    [...controls].filter(([name]) => !groups.some(({group, field}) => field.name === name && group.hidden))

  form.addEventListener('change', refresh)

  return new Promise((resolve) => {
    let settled = false
    // Assigned once the dialog is on screen. The glass module loads on first
    // use, so this can stay a no-op for the whole of a session that never
    // reaches the switch.
    let releaseGlass = () => {}
    const finish = (value) => {
      if (settled) return
      settled = true
      releaseGlass()
      dialog.close()
      dialog.remove()
      resolve(value)
    }

    cancel.addEventListener('click', () => finish(null))

    // Escape and a click on the backdrop both dismiss.
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      finish(null)
    })
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(null)
    })

    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const values = readValues()

      // A hidden field is not an answer, so it is not validated either: a
      // password box left with a stale custom validity would otherwise block a
      // submit that never touched it.
      for (const [name, inputs] of visibleControls()) {
        if (!inputs[0].checkValidity()) {
          inputs[0].reportValidity()
          return
        }
        if (name.endsWith('Confirm') && values[name] !== values[name.replace(/Confirm$/, '')]) {
          showError('The two passwords do not match.')
          inputs[0].focus()
          return
        }
      }

      const message = validate?.(values)
      if (message) {
        showError(message)
        return
      }
      finish(values)
    })

    document.body.append(dialog)
    dialog.showModal()
    releaseGlass = trackGlass(dialog)
    refresh()

    const [first] = controls.values()
    const focusTarget = first?.[0]
    focusTarget?.focus()
    if (focusTarget?.select) focusTarget.select()
  })
}

let dialogCounter = 0
function fieldId(name) {
  return 'dialog-' + name.replace(/[^a-z0-9-]/gi, '-') + '-' + ++dialogCounter
}

/**
 * One of the inline symbols from index.html, as an SVG element.
 *
 * `href` is the SVG 2 attribute and `xlink:href` the older one; setting both
 * means the icon works whichever the browser implements, and the two never
 * disagree because the name comes from the caller either way. Shared with the
 * panels, which would otherwise each build the same tree by hand.
 *
 * @param {string} name  the symbol's id, without the leading '#'
 * @param {number} [size]
 * @returns {SVGElement}
 */
export function icon(name, size = 20) {
  const namespace = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(namespace, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))

  const use = document.createElementNS(namespace, 'use')
  use.setAttribute('href', '#' + name)
  use.setAttribute('xlink:href', '#' + name)
  svg.append(use)
  return svg
}

/**
 * Ask for a password.
 *
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.message]
 * @param {boolean} [options.confirm]  ask twice, for a password about to be used
 * @param {number} [options.minLength]
 * @param {string} [options.submitLabel]
 * @returns {Promise<string | null>}
 */
export async function promptPassword(options) {
  const {title, message, confirm = false, minLength = 1, submitLabel = 'Continue'} = options

  const values = await showDialog({
    title,
    description: message,
    submitLabel,
    fields: [
      {name: 'password', type: 'password', label: 'Password', confirm, minLength},
      {
        name: 'hint',
        type: 'note',
        label: 'The password never leaves this page and is not stored anywhere.',
      },
    ],
    validate: (values) => {
      if (!values.password) return 'Enter a password.'
      if (minLength > 1 && values.password.length < minLength) {
        return `Use at least ${minLength} characters.`
      }
      return null
    },
  })

  return values?.password ?? null
}

/** A yes/no question. Resolves to false when dismissed. */
export async function confirmDialog({title, message, submitLabel = 'OK', danger = false}) {
  const values = await showDialog({
    title,
    description: message,
    submitLabel,
    danger,
    fields: [],
  })
  return values !== null
}
