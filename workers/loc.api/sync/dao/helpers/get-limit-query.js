'use strict'

module.exports = ({
  limit: limitParam,
  isNotPrefixed
} = {}) => {
  const key = isNotPrefixed ? '_limit' : '$_limit'
  const limit = Number.isInteger(limitParam) ? 'LIMIT $_limit' : ''
  const limitVal = limit ? { [key]: limitParam } : {}

  return { limit, limitVal }
}
