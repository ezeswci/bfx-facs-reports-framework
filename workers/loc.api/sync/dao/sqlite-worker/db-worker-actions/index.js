'use strict'

const dbWorkerActions = require(
  'bfx-facs-db-better-sqlite/worker/db-worker-actions'
)

const DB_WORKER_ACTIONS = require('./db-worker-actions.const')

const actionRun = require('./action-run')
const actionGet = require('./action-get')
const actionRunInTrans = require('./action-run-in-trans')
const actionExecPragma = require('./action-exec-pragma')

module.exports = (db, args) => {
  const { action, sql, params } = args

  if (action === DB_WORKER_ACTIONS.RUN) {
    return actionRun(db, sql, params)
  }
  if (action === DB_WORKER_ACTIONS.GET) {
    return actionGet(db, sql, params)
  }
  if (action === DB_WORKER_ACTIONS.RUN_IN_TRANS) {
    return actionRunInTrans(db, sql, params)
  }
  if (action === DB_WORKER_ACTIONS.EXEC_PRAGMA) {
    return actionExecPragma(db, sql, params)
  }

  return dbWorkerActions(db, args)
}
