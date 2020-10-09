'use strict'

const {
  decorate,
  injectable,
  inject
} = require('inversify')
const MAIN_DB_WORKER_ACTIONS = require(
  'bfx-facs-db-better-sqlite/worker/db-worker-actions/db-worker-actions.const'
)

const TYPES = require('../../di/types')

const DAO = require('./dao')
const {
  mixUserIdToArrData,
  getIndexCreationQuery,
  getTableCreationQuery,
  getTriggerCreationQuery,
  getTablesNamesQuery,
  getProjectionQuery,
  getPlaceholdersQuery,
  getOrderQuery,
  getWhereQuery
} = require('./helpers')

const {
  DbVersionTypeError,
  SqlCorrectnessError
} = require('../../errors')

const {
  TRIGGER_FIELD_NAME,
  INDEX_FIELD_NAME,
  UNIQUE_INDEX_FIELD_NAME
} = require('../schema/const')
const DB_WORKER_ACTIONS = require(
  './sqlite-worker/db-worker-actions/db-worker-actions.const'
)

// TODO:
class BetterSqliteDAO extends DAO {
  constructor (...args) {
    super(...args)

    this.asyncQuery = this.db.asyncQuery.bind(this.db)
    this.db = this.db.db
  }

  _createTablesIfNotExists () {
    const models = this._getModelsMap({
      omittedFields: [
        TRIGGER_FIELD_NAME,
        INDEX_FIELD_NAME,
        UNIQUE_INDEX_FIELD_NAME
      ]
    })
    const sql = getTableCreationQuery(models, true)

    return this.asyncQuery({
      action: DB_WORKER_ACTIONS.RUN_IN_TRANS,
      sql
    })
  }

  _createTriggerIfNotExists () {
    const models = this._getModelsMap({ omittedFields: [] })
    const sql = getTriggerCreationQuery(models, true)

    return this.asyncQuery({
      action: DB_WORKER_ACTIONS.RUN_IN_TRANS,
      sql
    })
  }

  _createIndexisIfNotExists () {
    const models = this._getModelsMap({ omittedFields: [] })
    const sql = getIndexCreationQuery(models)

    return this.asyncQuery({
      action: DB_WORKER_ACTIONS.RUN_IN_TRANS,
      sql
    })
  }

  async getTablesNames () {
    const sql = getTablesNamesQuery()
    const data = await this.asyncQuery({
      action: MAIN_DB_WORKER_ACTIONS.ALL,
      sql
    })

    if (!Array.isArray(data)) {
      return []
    }

    return data.map(({ name }) => name)
  }

  enableWALJournalMode () {
    return this.asyncQuery({
      action: DB_WORKER_ACTIONS.EXEC_PRAGMA,
      sql: 'journal_mode = WAL'
    })
  }

  enableForeignKeys () {
    return this.asyncQuery({
      action: DB_WORKER_ACTIONS.EXEC_PRAGMA,
      sql: 'foreign_keys = ON'
    })
  }

  disableForeignKeys () {
    return this.asyncQuery({
      action: DB_WORKER_ACTIONS.EXEC_PRAGMA,
      sql: 'foreign_keys = OFF'
    })
  }

  dropTable (name, isDroppedIfExists) {
    if (
      !name ||
      typeof name !== 'string'
    ) {
      throw new SqlCorrectnessError()
    }

    const condition = isDroppedIfExists
      ? ' IF EXISTS'
      : ''

    return this.asyncQuery({
      action: DB_WORKER_ACTIONS.RUN_IN_TRANS,
      sql: `DROP TABLE${condition} ${name}`,
      params: { transVersion: 'exclusive' }
    })
  }

  /**
   * @override
   */
  async beforeMigrationHook () {
    await this.enableForeignKeys()
    await this.enableWALJournalMode()
  }

  /**
   * TODO:
   * @override
   */
  async databaseInitialize (db) {
    await super.databaseInitialize(db)

    await this._createTablesIfNotExists()
    await this._createIndexisIfNotExists()
    await this._createTriggerIfNotExists()
    await this.setCurrDbVer(this.syncSchema.SUPPORTED_DB_VERSION)
  }

  /**
   * @override
   */
  async isDBEmpty () {
    const tablesNames = await this.getTablesNames()

    return (
      !Array.isArray(tablesNames) ||
      tablesNames.length === 0
    )
  }

  /**
   * @override
   */
  getCurrDbVer () {
    return this.asyncQuery({
      action: DB_WORKER_ACTIONS.EXEC_PRAGMA,
      sql: 'user_version'
    })
  }

  /**
   * @override
   */
  setCurrDbVer (version) {
    if (!Number.isInteger(version)) {
      throw new DbVersionTypeError()
    }

    return this.asyncQuery({
      action: DB_WORKER_ACTIONS.EXEC_PRAGMA,
      sql: `user_version = ${version}`
    })
  }

  /**
   * @override
   */
  async insertElemToDb (
    name,
    obj = {},
    opts = {}
  ) {
    const {
      isReplacedIfExists
    } = { ...opts }

    const keys = Object.keys(obj)
    const projection = getProjectionQuery(keys)
    const {
      placeholders,
      placeholderVal: params
    } = getPlaceholdersQuery(obj, keys, { isNotPrefixed: true })
    const replace = isReplacedIfExists
      ? ' OR REPLACE'
      : ''

    const sql = `INSERT${replace} 
      INTO ${name}(${projection})
      VALUES (${placeholders})`

    await this.asyncQuery({
      action: DB_WORKER_ACTIONS.RUN,
      sql,
      params
    })
  }

  /**
   * @override
   */
  async insertElemsToDb (
    name,
    auth,
    data = [],
    opts = {}
  ) {
    const {
      isReplacedIfExists
    } = { ...opts }
    const _data = mixUserIdToArrData(
      auth,
      data
    )
    const sql = []
    const params = []

    for (const obj of _data) {
      const keys = Object.keys(obj)

      if (keys.length === 0) {
        continue
      }

      const projection = getProjectionQuery(keys)
      const {
        placeholders,
        placeholderVal
      } = getPlaceholdersQuery(obj, keys, { isNotPrefixed: true })
      const replace = isReplacedIfExists
        ? ' OR REPLACE'
        : ''

      sql.push(
        `INSERT${replace}
          INTO ${name}(${projection})
          VALUES (${placeholders})`
      )
      params.push(placeholderVal)
    }

    if (sql.length === 0) {
      return
    }

    await this.asyncQuery({
      action: DB_WORKER_ACTIONS.RUN_IN_TRANS,
      sql,
      params
    })
  }

  /**
   * @override
   */
  getElemInCollBy (
    name,
    filter = {},
    sort = []
  ) {
    const _sort = getOrderQuery(sort)
    const {
      where,
      values: params
    } = getWhereQuery(filter, { isNotPrefixed: true })

    const sql = `SELECT * FROM ${name}
      ${where}
      ${_sort}`

    return this.asyncQuery({
      action: DB_WORKER_ACTIONS.GET,
      sql,
      params
    })
  }

  updateRecordOf () {}

  updateCollBy () {}
}

decorate(injectable(), BetterSqliteDAO)
decorate(inject(TYPES.DB), BetterSqliteDAO, 0)
decorate(inject(TYPES.TABLES_NAMES), BetterSqliteDAO, 1)
decorate(inject(TYPES.SyncSchema), BetterSqliteDAO, 2)
decorate(inject(TYPES.PrepareResponse), BetterSqliteDAO, 3)
decorate(inject(TYPES.DbMigratorFactory), BetterSqliteDAO, 4)

module.exports = BetterSqliteDAO
