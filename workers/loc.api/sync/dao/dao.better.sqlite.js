'use strict'

const {
  decorate,
  injectable,
  inject
} = require('inversify')

const TYPES = require('../../di/types')

const DAO = require('./dao')
const {
  getIndexCreationQuery,
  getTableCreationQuery,
  getTriggerCreationQuery
} = require('./helpers')
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
    // await this.setCurrDbVer(this.syncSchema.SUPPORTED_DB_VERSION)
  }

  getElemInCollBy () {}

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
