'use strict'

const { promisify } = require('util')
const setImmediatePromise = promisify(setImmediate)
const {
  decorate,
  injectable,
  inject
} = require('inversify')
const {
  getLimitNotMoreThan,
  checkFilterParams,
  normalizeFilterParams
} = require('bfx-report/workers/loc.api/helpers')
const {
  AuthError
} = require('bfx-report/workers/loc.api/errors')

const TYPES = require('../../di/types')

const DAO = require('./dao')
const {
  mixUserIdToArrData,
  convertDataType,
  mapObjBySchema,
  getWhereQuery,
  getLimitQuery,
  getOrderQuery,
  getIndexCreationQuery,
  getInsertableArrayObjectsFilter,
  getStatusMessagesFilter,
  getProjectionQuery,
  getPlaceholdersQuery,
  serializeObj,
  getGroupQuery,
  getSubQuery,
  filterModelNameMap,
  getTableCreationQuery,
  getTriggerCreationQuery,
  isContainedSameMts,
  getTablesNamesQuery,
  normalizeUserData,
  getUsersIds,
  fillSubUsers,
  getSubUsersQuery,
  getUsersQuery,
  manageTransaction
} = require('./helpers')
const {
  RemoveListElemsError,
  UpdateRecordError,
  SqlCorrectnessError,
  DbVersionTypeError
} = require('../../errors')
const {
  TRIGGER_FIELD_NAME,
  INDEX_FIELD_NAME,
  UNIQUE_INDEX_FIELD_NAME
} = require('../schema/const')

class SqliteDAO extends DAO {
  _run (sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) {
          reject(err)

          return
        }

        resolve(this)
      })
    })
  }

  _get (sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, result) => {
        if (err) {
          reject(err)

          return
        }

        resolve(result)
      })
    })
  }

  _all (sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err)

          return
        }

        resolve(rows)
      })
    })
  }

  _parallelize (cb) {
    return new Promise((resolve, reject) => {
      try {
        if (typeof cb !== 'function') {
          this.db.parallelize()
          resolve()

          return
        }

        this.db.parallelize(async function () {
          try {
            const res = await cb()

            resolve(res)
          } catch (err) {
            reject(err)
          }
        })
      } catch (err) {
        reject(err)
      }
    })
  }

  _serialize (cb) {
    return new Promise((resolve, reject) => {
      try {
        if (typeof cb !== 'function') {
          this.db.serialize()
          resolve()

          return
        }

        this.db.serialize(async function () {
          try {
            const res = await cb()

            resolve(res)
          } catch (err) {
            reject(err)
          }
        })
      } catch (err) {
        reject(err)
      }
    })
  }

  _transact () {
    return this._run('BEGIN TRANSACTION')
  }

  _commit () {
    return this._run('COMMIT')
  }

  _rollback () {
    return this._run('ROLLBACK')
  }

  _proccesTrans (
    asyncExecQuery,
    opts = {}
  ) {
    const {
      isParallelize,
      beforeTransFn,
      afterTransFn
    } = { ...opts }

    return this._serialize(async () => {
      let isTransBegun = false

      try {
        if (typeof beforeTransFn === 'function') {
          await beforeTransFn()
        }

        await this._transact()
        isTransBegun = true

        const res = isParallelize
          ? await this._parallelize(asyncExecQuery)
          : await this._serialize(asyncExecQuery)

        await this._commit()

        if (typeof afterTransFn === 'function') {
          await afterTransFn()
        }

        return res
      } catch (err) {
        if (isTransBegun) {
          await this._rollback()
        }
        if (typeof afterTransFn === 'function') {
          await afterTransFn()
        }

        throw err
      }
    })
  }

  async _beginTrans (
    asyncExecQuery,
    opts = {}
  ) {
    return manageTransaction(
      () => this._proccesTrans(asyncExecQuery, opts)
    )
  }

  async _createTablesIfNotExists () {
    const models = this._getModelsMap({
      omittedFields: [
        TRIGGER_FIELD_NAME,
        INDEX_FIELD_NAME,
        UNIQUE_INDEX_FIELD_NAME
      ]
    })
    const sqlArr = getTableCreationQuery(models, true)

    for (const sql of sqlArr) {
      await this._run(sql)
    }
  }

  async _createTriggerIfNotExists () {
    const models = this._getModelsMap({ omittedFields: [] })
    const sqlArr = getTriggerCreationQuery(models, true)

    for (const sql of sqlArr) {
      await this._run(sql)
    }
  }

  async _createIndexisIfNotExists () {
    const models = this._getModelsMap({ omittedFields: [] })
    const sqlArr = getIndexCreationQuery(models)

    for (const sql of sqlArr) {
      await this._run(sql)
    }
  }

  async _getUsers (filter, opts) {
    const {
      isNotInTrans,
      isFoundOne,
      haveNotSubUsers,
      haveSubUsers,
      isFilledSubUsers,
      sort = ['_id'],
      limit
    } = { ...opts }

    const { sql, values } = getUsersQuery(
      filter,
      {
        isFoundOne,
        haveNotSubUsers,
        haveSubUsers,
        sort,
        limit
      }
    )
    const queryUsersFn = async () => {
      const _res = isFoundOne
        ? await this._get(sql, values)
        : await this._all(sql, values)

      if (
        !_res ||
        typeof _res !== 'object'
      ) {
        return _res
      }

      const res = normalizeUserData(_res)
      const usersFilledSubUsers = isFilledSubUsers
        ? await this._fillSubUsers(res)
        : res

      return usersFilledSubUsers
    }

    if (isNotInTrans) {
      return queryUsersFn()
    }

    return this._beginTrans(queryUsersFn)
  }

  async _fillSubUsers (users) {
    const isArray = Array.isArray(users)
    const _users = isArray ? users : [users]
    const usersIds = getUsersIds(_users)

    if (usersIds.length === 0) {
      return users
    }

    const { sql, values } = getSubUsersQuery(
      { $in: { _id: usersIds } },
      { sort: ['_id'] }
    )
    const res = await this._all(sql, values)

    const _subUsers = normalizeUserData(res)
    const filledUsers = fillSubUsers(_users, _subUsers)

    return isArray ? filledUsers : filledUsers[0]
  }

  async _getTablesNames () {
    const sql = getTablesNamesQuery()
    const data = await this._all(sql)

    if (!Array.isArray(data)) {
      return []
    }

    return data.map(({ name }) => name)
  }

  enableForeignKeys () {
    return this._run('PRAGMA foreign_keys = ON')
  }

  disableForeignKeys () {
    return this._run('PRAGMA foreign_keys = OFF')
  }

  async dropAllTables () {
    const tableNames = await this._getTablesNames()
    const sqlArr = tableNames.map((name) => (
      `DROP TABLE IF EXISTS ${name}`
    ))

    await this._beginTrans(async () => {
      const promises = sqlArr.map((sql) => this._run(sql))

      await Promise.all(promises)
    }, { isParallelize: true })
  }

  /**
   * @override
   */
  beforeMigrationHook () {
    return this.enableForeignKeys()
  }

  /**
   * @override
   */
  async databaseInitialize (db) {
    await super.databaseInitialize(db)

    await this._beginTrans(async () => {
      await this._createTablesIfNotExists()
      await this._createIndexisIfNotExists()
      await this._createTriggerIfNotExists()
      await this.setCurrDbVer(this.syncSchema.SUPPORTED_DB_VERSION)
    })
  }

  /**
   * @override
   */
  async isDBEmpty () {
    const tableNames = await this._getTablesNames()

    return (
      !Array.isArray(tableNames) ||
      tableNames.length === 0
    )
  }

  /**
   * @override
   */
  async getCurrDbVer () {
    const data = await this._get('PRAGMA user_version')
    const { user_version: version } = { ...data }

    return version
  }

  /**
   * @override
   */
  async setCurrDbVer (version) {
    if (!Number.isInteger(version)) {
      throw new DbVersionTypeError()
    }

    this._run(`PRAGMA user_version = ${version}`)
  }

  /**
   * @override
   */
  async executeQueriesInTrans (
    sql,
    {
      beforeTransFn,
      afterTransFn
    } = {}
  ) {
    const isArray = Array.isArray(sql)
    const sqlArr = isArray ? sql : [sql]

    if (sqlArr.length === 0) {
      return
    }

    const res = []

    return this._beginTrans(async () => {
      for (const sqlData of sqlArr) {
        const _sql = typeof sqlData === 'string'
          ? sqlData
          : null
        const _execQueryFn = typeof sqlData === 'function'
          ? sqlData
          : null
        const _sqlData = typeof sqlData === 'object'
          ? sqlData
          : { sql: _sql, execQueryFn: _execQueryFn }
        const { sql, values, execQueryFn } = { ..._sqlData }
        const hasSql = sql && typeof sql === 'string'
        const hasExecQueryFn = typeof execQueryFn === 'function'

        if (!hasSql && !hasExecQueryFn) {
          throw new SqlCorrectnessError()
        }

        if (sql && typeof sql === 'string') {
          res.push(await this._run(sql, values))
        }
        if (typeof execQueryFn === 'function') {
          res.push(await execQueryFn())
        }
      }

      return isArray ? res : res[0]
    }, { beforeTransFn, afterTransFn })
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
      placeholderVal
    } = getPlaceholdersQuery(obj, keys)
    const replace = isReplacedIfExists
      ? ' OR REPLACE'
      : ''

    const sql = `INSERT${replace} INTO ${name}(${projection}) VALUES (${placeholders})`

    await this._run(sql, placeholderVal)
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

    const sql = []
    const params = []

    for (const obj of data) {
      await setImmediatePromise()

      const _obj = mixUserIdToArrData(
        auth,
        obj
      )
      const keys = Object.keys(_obj)

      if (keys.length === 0) {
        continue
      }

      const projection = getProjectionQuery(keys)
      const {
        placeholders,
        placeholderVal
      } = getPlaceholdersQuery(_obj, keys)
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

    await this._beginTrans(async () => {
      const promises = []

      for (const [i, param] of params.entries()) {
        await setImmediatePromise()

        promises.push(this._run(sql[i], param))
      }

      await Promise.all(promises)
    }, { isParallelize: true })
  }

  /**
   * @override
   */
  async insertElemsToDbIfNotExists (
    name,
    auth,
    data = []
  ) {
    const sql = []
    const params = []

    for (const obj of data) {
      await setImmediatePromise()

      const _obj = mixUserIdToArrData(
        auth,
        obj
      )
      const keys = Object.keys(_obj)

      if (keys.length === 0) {
        continue
      }

      const item = serializeObj(_obj, keys)
      const projection = getProjectionQuery(keys)
      const {
        where,
        values
      } = getWhereQuery(item)
      const {
        placeholders,
        placeholderVal
      } = getPlaceholdersQuery(item, keys)

      sql.push(
        `INSERT INTO ${name}(${projection}) SELECT ${placeholders}
          WHERE NOT EXISTS(SELECT 1 FROM ${name} ${where})`
      )
      params.push({ ...values, ...placeholderVal })
    }

    if (sql.length === 0) {
      return
    }

    await this._beginTrans(async () => {
      const promises = []

      for (const [i, param] of params.entries()) {
        await setImmediatePromise()

        promises.push(this._run(sql[i], param))

        await Promise.all(promises)
      }
    }, { isParallelize: true })
  }

  /**
   * @override
   */
  async findInCollBy (
    method,
    reqArgs,
    {
      isPrepareResponse = false,
      isPublic = false,
      additionalModel,
      schema = {},
      isExcludePrivate = true,
      isNotConsideredSameMts
    } = {}
  ) {
    const filterModelName = filterModelNameMap.get(method)

    const args = normalizeFilterParams(method, reqArgs)
    checkFilterParams(filterModelName, args)

    const { auth: user } = { ...args }
    const methodColl = {
      ...this._getMethodCollMap().get(method),
      ...schema
    }
    const params = { ...args.params }
    const { filter: requestedFilter } = params
    const {
      maxLimit,
      dateFieldName,
      symbolFieldName,
      sort: _sort,
      model,
      dataStructureConverter,
      name
    } = { ...methodColl }
    params.limit = maxLimit
      ? getLimitNotMoreThan(params.limit, maxLimit)
      : null
    const _model = { ...model, ...additionalModel }

    const exclude = ['_id']
    const statusMessagesfilter = getStatusMessagesFilter(
      methodColl,
      params
    )
    const insertableArrayObjectsFilter = getInsertableArrayObjectsFilter(
      methodColl,
      params
    )
    const filter = {
      ...insertableArrayObjectsFilter,
      ...statusMessagesfilter
    }

    if (!isPublic) {
      const { _id } = { ...user }

      if (!Number.isInteger(_id)) {
        throw new AuthError()
      }

      exclude.push('user_id')
      filter.user_id = user._id
    }

    const {
      limit,
      limitVal
    } = getLimitQuery(params)
    const sort = getOrderQuery(_sort)
    const {
      where,
      values
    } = getWhereQuery(filter, { requestedFilter })
    const group = getGroupQuery(methodColl)
    const subQuery = getSubQuery(methodColl)
    const projection = getProjectionQuery(
      _model,
      exclude,
      isExcludePrivate
    )

    const sql = `SELECT ${projection} FROM ${subQuery}
      ${where}
      ${group}
      ${sort}
      ${limit}`

    const _res = await this._all(sql, { ...values, ...limitVal })
    const convertedDataStructure = (
      typeof dataStructureConverter === 'function'
    )
      ? _res.reduce(methodColl.dataStructureConverter, [])
      : _res
    const res = convertDataType(convertedDataStructure)

    if (isPrepareResponse) {
      const _isContainedSameMts = isContainedSameMts(
        res,
        dateFieldName,
        params.limit
      )

      if (
        isNotConsideredSameMts ||
        !_isContainedSameMts
      ) {
        const symbols = (
          params.symbol &&
          Array.isArray(params.symbol) &&
          params.symbol.length > 1
        ) ? params.symbol : []

        return this.prepareResponse(
          res,
          dateFieldName,
          params.limit,
          params.notThrowError,
          params.notCheckNextPage,
          symbols,
          symbolFieldName,
          name
        )
      }

      const _args = {
        ...args,
        params: {
          ...args.params,
          limit: maxLimit
        }
      }

      return this.findInCollBy(
        method,
        _args,
        {
          isPrepareResponse,
          isPublic,
          additionalModel,
          schema,
          isExcludePrivate,
          isNotConsideredSameMts: true
        }
      )
    }

    return res
  }

  /**
   * @override
   */
  async updateCollBy (name, filter = {}, data = {}) {
    const {
      where,
      values
    } = getWhereQuery(filter)
    const fields = Object.keys(data).map(item => {
      const key = `$new_${item}`
      values[key] = data[item]

      return `${item} = ${key}`
    }).join(', ')

    const sql = `UPDATE ${name} SET ${fields} ${where}`

    return this._run(sql, values)
  }

  /**
   * @override
   */
  async updateElemsInCollBy (
    name,
    data = [],
    filterPropNames = {},
    upPropNames = {}
  ) {
    const sql = []
    const params = []

    for (const obj of data) {
      await setImmediatePromise()

      const filter = mapObjBySchema(obj, filterPropNames)
      const newItem = mapObjBySchema(obj, upPropNames)
      const {
        where,
        values
      } = getWhereQuery(filter)
      const fields = Object.keys(newItem).map((item) => {
        const key = `$new_${item}`
        values[key] = newItem[item]

        return `${item} = ${key}`
      }).join(', ')

      sql.push(`UPDATE ${name} SET ${fields} ${where}`)
      params.push(values)
    }

    if (sql.length === 0) {
      return
    }

    await this._beginTrans(async () => {
      const promises = []

      for (const [i, param] of params.entries()) {
        await setImmediatePromise()

        promises.push(this._run(sql[i], param))
      }

      await Promise.all(promises)
    }, { isParallelize: true })
  }

  /**
   * @override
   */
  getUser (
    filter,
    {
      isNotInTrans,
      haveNotSubUsers,
      haveSubUsers,
      isFilledSubUsers,
      sort = ['_id']
    } = {}
  ) {
    return this._getUsers(
      filter,
      {
        isNotInTrans,
        isFoundOne: true,
        haveNotSubUsers,
        haveSubUsers,
        isFilledSubUsers,
        sort
      }
    )
  }

  /**
   * @override
   */
  getUsers (
    filter,
    {
      isNotInTrans,
      haveNotSubUsers,
      haveSubUsers,
      isFilledSubUsers,
      sort = ['_id'],
      limit
    } = {}
  ) {
    return this._getUsers(
      filter,
      {
        isNotInTrans,
        haveNotSubUsers,
        haveSubUsers,
        isFilledSubUsers,
        sort,
        limit
      }
    )
  }

  /**
   * @override
   */
  getElemsInCollBy (
    collName,
    {
      filter = {},
      sort = [],
      subQuery = {
        sort: []
      },
      groupResBy = [],
      isDistinct = false,
      projection = [],
      exclude = [],
      isExcludePrivate = false,
      limit = null
    } = {}
  ) {
    const group = getGroupQuery({ groupResBy })
    const _subQuery = getSubQuery({ name: collName, subQuery })
    const _sort = getOrderQuery(sort)
    const {
      where,
      values
    } = getWhereQuery(filter)
    const _projection = getProjectionQuery(
      projection,
      exclude,
      isExcludePrivate
    )
    const distinct = isDistinct ? 'DISTINCT ' : ''
    const {
      limit: _limit,
      limitVal
    } = getLimitQuery({ limit })

    const sql = `SELECT ${distinct}${_projection} FROM ${_subQuery}
      ${where}
      ${group}
      ${_sort}
      ${_limit}`

    return this._all(sql, { ...values, ...limitVal })
  }

  /**
   * @override
   */
  getElemInCollBy (collName, filter = {}, sort = []) {
    const _sort = getOrderQuery(sort)
    const {
      where,
      values
    } = getWhereQuery(filter)

    const sql = `SELECT * FROM ${collName}
      ${where}
      ${_sort}`

    return this._get(sql, values)
  }

  /**
   * @override
   */
  async removeElemsFromDb (name, auth, data = {}) {
    if (auth) {
      const { _id } = { ...auth }

      if (!Number.isInteger(_id)) {
        throw new AuthError()
      }

      data.user_id = _id
    }

    const {
      where,
      values
    } = getWhereQuery(data)

    const sql = `DELETE FROM ${name} ${where}`

    return this._run(sql, values)
  }

  /**
   * @override
   */
  async removeElemsFromDbIfNotInLists (name, lists) {
    const areAllListsNotArr = Object.keys(lists).every(key => (
      !Array.isArray(lists[key])
    ))

    if (areAllListsNotArr) {
      throw new RemoveListElemsError()
    }

    const $or = Object.entries(lists).reduce((accum, [key, val]) => {
      return {
        $not: {
          ...accum.$not,
          [key]: val
        }
      }
    }, { $not: {} })
    const {
      where,
      values
    } = getWhereQuery({ $or })

    const sql = `DELETE FROM ${name} ${where}`

    await this._run(sql, values)
  }

  /**
   * @override
   */
  async updateRecordOf (name, data) {
    await this._beginTrans(async () => {
      const elems = await this.getElemsInCollBy(name)
      const record = serializeObj(data)

      if (!Array.isArray(elems)) {
        throw new UpdateRecordError()
      }
      if (elems.length > 1) {
        await this.removeElemsFromDb(name, null, {
          _id: elems.filter((item, i) => i !== 0)
        })
      }
      if (elems.length === 0) {
        await this.insertElemToDb(
          name,
          record
        )

        return
      }

      const { _id } = { ...elems[0] }
      const res = await this.updateCollBy(
        name,
        { _id },
        record
      )

      if (res && res.changes < 1) {
        throw new UpdateRecordError()
      }
    })
  }
}

decorate(injectable(), SqliteDAO)
decorate(inject(TYPES.DB), SqliteDAO, 0)
decorate(inject(TYPES.TABLES_NAMES), SqliteDAO, 1)
decorate(inject(TYPES.SyncSchema), SqliteDAO, 2)
decorate(inject(TYPES.PrepareResponse), SqliteDAO, 3)
decorate(inject(TYPES.DbMigratorFactory), SqliteDAO, 4)

module.exports = SqliteDAO
