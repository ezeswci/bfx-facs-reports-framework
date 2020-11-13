'use strict'

const {
  getLimitNotMoreThan
} = require('bfx-report/workers/loc.api/helpers')

module.exports = (args, methodColl) => {
  const { params: reqParams } = { ...args }
  const params = { ...reqParams }
  const { maxLimit } = { ...methodColl }

  params.limit = maxLimit
    ? getLimitNotMoreThan(params.limit, maxLimit)
    : null
}
