'use strict'

const {
  tryParseJSON
} = require('../../../helpers')

const serializeVal = (val) => {
  if (typeof val === 'boolean') {
    return +val
  }
  if (
    val &&
    typeof val === 'object'
  ) {
    return JSON.stringify(val)
  }

  return val
}

const serializeObj = (obj, keys) => {
  const _keys = Array.isArray(keys)
    ? keys
    : Object.keys(obj)

  return _keys.reduce((accum, key) => ({
    ...accum,
    [key]: serializeVal(obj[key])
  }), {})
}

const deserializeVal = (
  val,
  key,
  boolFields = [
    'notify',
    'hidden',
    'renew',
    'noClose',
    'maker',
    '_isMarginFundingPayment',
    '_isAffiliateRebate',
    '_isStakingPayments'
  ]
) => {
  if (
    typeof val === 'number' &&
    boolFields.some(item => item === key)
  ) {
    return !!val
  }
  if (
    typeof val === 'string' &&
    key === 'rate'
  ) {
    const _val = parseFloat(val)

    return isFinite(_val) ? _val : val
  }
  if (tryParseJSON(val)) {
    return tryParseJSON(val)
  }

  return val
}

module.exports = {
  serializeVal,
  serializeObj,
  deserializeVal
}
