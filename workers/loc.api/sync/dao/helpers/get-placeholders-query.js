'use strict'

const serializeVal = require('./serialization/serialize-val')

module.exports = (obj, keys, opts) => {
  const { isNotPrefixed = false } = { ...opts }
  const prefix = isNotPrefixed ? '' : '$'
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
