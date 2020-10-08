'use strict'

const { serializeVal } = require('./serialization')

module.exports = (obj, keys, opts) => {
  const { isPrefixed = true } = { ...opts }
  const prefix = isPrefixed ? '$' : ''
  const _keys = Array.isArray(keys)
    ? keys
    : Object.keys(obj)
  const placeholderVal = {}
  const placeholderArr = _keys.map((item, i) => {
    const key = `${prefix}${item}`

    placeholderVal[key] = serializeVal(obj[item])

    return `$${item}`
  })
  const placeholders = placeholderArr.join(', ')

  return { placeholders, placeholderVal }
}
