'use strict'

const TYPES = require('../types')

module.exports = (ctx) => {
  const { dbDriver } = ctx.container.get(
    TYPES.CONF
  )

  return () => {
    const dao = ctx.container.get(
      TYPES.DAO
    )

    if (/sqlite/gi.test(dbDriver)) {
      const sqliteDbMigrator = ctx.container.get(
        TYPES.SqliteDbMigrator
      )
      sqliteDbMigrator.setDao(dao)

      return sqliteDbMigrator
    }
  }
}
