'use strict'

const { promisify } = require('util')
const setImmediatePromise = promisify(setImmediate)
const { pick, omit, orderBy } = require('lodash')

const _getDataKeys = (data) => {
  return Object.keys(data)
    .filter(key => (
      Array.isArray(data[key]) &&
      data[key].length > 0
    ))
}

const _getMaxLength = (data) => {
  const dataArr = Object.values(data)

  if (dataArr.length === 0) {
    return 0
  }

  return Math.max(
    ...dataArr.map(item => item.length)
  )
}

const _mergeData = async (data) => {
  if (
    !data ||
    typeof data !== 'object'
  ) {
    return []
  }

  const dataKeys = _getDataKeys(data)
  const _data = pick(data, dataKeys)
  const maxLength = _getMaxLength(_data)
  const res = []

  for (let i = 0; maxLength > i; i += 1) {
    if ((i % 10) === 0) {
      await setImmediatePromise()
    }

    dataKeys.forEach(key => {
      const { mts, vals } = { ..._data[key][i] }

      if (
        !Number.isInteger(mts) ||
        !vals ||
        typeof vals !== 'object' ||
        Object.keys(vals).length === 0
      ) {
        return
      }

      for (const [index, item] of res.entries()) {
        if (mts === item.mts) {
          res[index] = {
            ...item,
            [key]: { ...vals }
          }

          return
        }
      }

      res.push({
        mts,
        [key]: { ...vals }
      })
    })
  }

  return orderBy(res, ['mts'], ['desc'])
}

const _calcDataItem = (item = []) => {
  const _item = Object.values(omit(item, ['mts']))

  return _item.reduce((accum, curr) => {
    Object.entries(curr).forEach(([symb, val]) => {
      if (!Number.isFinite(val)) {
        return
      }
      if (Number.isFinite(accum[symb])) {
        accum[symb] += val

        return
      }

      accum[symb] = val
    })

    return accum
  }, {})
}

const _getReducer = (
  isSubCalc,
  isReverse,
  calcDataItem
) => {
  return async (asyncAccum, item, i, arr) => {
    const accum = await asyncAccum

    if ((i % 10) === 0) {
      await setImmediatePromise()
    }

    const res = await calcDataItem(item, i, arr, accum)

    if (
      !res ||
      typeof res !== 'object' ||
      Object.keys(res).length === 0
    ) {
      return accum
    }

    const data = {
      mts: item.mts,
      ...(isSubCalc ? { vals: { ...res } } : res)
    }

    if (isReverse) {
      accum.unshift(data)

      return accum
    }

    accum.push(data)

    return accum
  }
}

module.exports = async (
  data,
  isSubCalc,
  calcDataItem = _calcDataItem,
  isReverse
) => {
  const _data = await _mergeData(data)
  const reducer = _getReducer(
    isSubCalc,
    isReverse,
    calcDataItem
  )
  const initVal = Promise.resolve([])

  if (isReverse) {
    return _data.reduceRight(reducer, initVal)
  }

  return _data.reduce(reducer, initVal)
}
