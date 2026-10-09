// The two pieces of news the shell passes around, so that the module holding
// the note does not have to import the modules that draw around it:
//
//   'note'  the text on screen changed or was saved - panels that show
//           something about it answer again
//   'menu'  something a menu row displays moved - the rows are redrawn

const handlers = {}

export function on(name, fn) {
  ;(handlers[name] ??= []).push(fn)
}

export function emit(name) {
  for (const fn of handlers[name] ?? []) fn()
}
