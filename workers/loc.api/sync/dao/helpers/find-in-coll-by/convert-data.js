'use strict'

const { promisify } = require('util')
const setImmediatePromise = promisify(setImmediate)

const deserializeVal = require('../serialization/deserialize-val')

module.exports = async (data, methodColl) => {
  if (
    !Array.isArray(data) ||
    data.length === 0
  ) {
    return data
  }

  const isConvAvailable = typeof methodColl.dataStructureConverter === 'function'

  let accum = []

  for (const [i, obj] of data.entries()) {
    if ((i % 100) === 0) {
      await setImmediatePromise()
    }
    if (
      !obj ||
      typeof obj !== 'object'
    ) {
      continue
    }
    if (isConvAvailable) {
      accum = methodColl.dataStructureConverter(accum, obj)
    }

    const converted = isConvAvailable
      ? accum[accum.length - 1]
      : obj

    Object.keys(converted).forEach((key) => {
      converted[key] = deserializeVal(converted[key], key)
    })
  }

  return isConvAvailable ? accum : data
}
