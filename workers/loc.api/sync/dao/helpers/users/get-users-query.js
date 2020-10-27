'use strict'

const getWhereQuery = require('../get-where-query')
const getLimitQuery = require('../get-limit-query')
const getOrderQuery = require('../get-order-query')

module.exports = (filter, opts) => {
  const {
    isFoundOne,
    haveNotSubUsers,
    haveSubUsers,
    sort = ['_id'],
    limit
  } = { ...opts }

  const userTableAlias = 'u'
  const {
    limit: _limit,
    limitVal
  } = getLimitQuery({ limit: isFoundOne ? null : limit })
  const {
    where,
    values: _values
  } = getWhereQuery(
    filter,
    {
      isNotSetWhereClause: true,
      alias: userTableAlias
    }
  )
  const haveSubUsersQuery = haveSubUsers
    ? 'sa.subUserId IS NOT NULL'
    : ''
  const haveNotSubUsersQuery = haveNotSubUsers
    ? 'sa.subUserId IS NULL'
    : ''
  const whereQueries = [
    where,
    haveSubUsersQuery,
    haveNotSubUsersQuery
  ].filter((query) => query).join(' AND ')
  const _where = whereQueries ? `WHERE ${whereQueries}` : ''
  const _sort = getOrderQuery(sort)
  const group = `GROUP BY ${userTableAlias}._id`
  const values = { ..._values, ...limitVal }

  const sql = `SELECT ${userTableAlias}.*, sa.subUserId as haveSubUsers
    FROM ${this.TABLES_NAMES.USERS} AS ${userTableAlias}
    LEFT JOIN ${this.TABLES_NAMES.SUB_ACCOUNTS} AS sa
      ON ${userTableAlias}._id = sa.masterUserId
    ${_where}
    ${group}
    ${_sort}
    ${_limit}`

  return { sql, values }
}
