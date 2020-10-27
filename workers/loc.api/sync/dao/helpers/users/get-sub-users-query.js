'use strict'

const getWhereQuery = require('../get-where-query')
const getOrderQuery = require('../get-order-query')

module.exports = (
  masterUser,
  sort = ['_id']
) => {
  const tableAlias = 'mu'
  const {
    where,
    values
  } = getWhereQuery(masterUser, { alias: tableAlias })
  const _sort = getOrderQuery(sort)

  const sql = `SELECT su.*, ${tableAlias}._id AS masterUserId
    FROM ${this.TABLES_NAMES.USERS} AS su
    INNER JOIN ${this.TABLES_NAMES.SUB_ACCOUNTS} AS sa
      ON su._id = sa.subUserId
    INNER JOIN ${this.TABLES_NAMES.USERS} AS ${tableAlias}
      ON ${tableAlias}._id = sa.masterUserId
    ${where}
    ${_sort}`

  return { sql, values }
}
