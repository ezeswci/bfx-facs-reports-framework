'use strict'

const { promisify } = require('util')
const setImmediatePromise = promisify(setImmediate)

const _transactionPromises = []

const _manageTrans = async (proccesTransFn, ...args) => {
  await Promise.allSettled(_transactionPromises)
  await setImmediatePromise()

  return proccesTransFn(...args)
}

module.exports = async (
  proccesTransFn,
  ...args
) => {
  const _transactionPromise = _manageTrans(
    proccesTransFn,
    ...args
  )
  const length = _transactionPromises
    .push(_transactionPromise)
  const index = length - 1

  try {
    const res = await _transactionPromise
    _transactionPromises.splice(index, 1)

    return res
  } catch (err) {
    _transactionPromises.splice(index, 1)

    throw err
  }
}
