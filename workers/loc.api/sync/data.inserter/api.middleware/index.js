'use strict'

const {
  FindMethodError
} = require('bfx-report/workers/loc.api/errors')
const {
  decorate,
  injectable,
  inject
} = require('inversify')

const TYPES = require('../../../di/types')
const COLLS_TYPES = require('../../schema/colls.types')
const SYNC_API_METHODS = require('../../schema/sync.api.methods')

class ApiMiddleware {
  constructor (
    rService,
    apiMiddlewareHandlerAfter,
    syncSchema
  ) {
    this.rService = rService
    this.apiMiddlewareHandlerAfter = apiMiddlewareHandlerAfter
    this.syncSchema = syncSchema

    this._methodCollMap = this.syncSchema.getMethodCollMap()
  }

  hasMethod (method) {
    return typeof this.rService[method] === 'function'
  }

  _hasHandlerAfter (method) {
    return typeof this.apiMiddlewareHandlerAfter[method] === 'function'
  }

  _logTime (method) {
    if (method) {
      console.log('[METHOD]:'.bgBlue, method)
    }

    console.log('[TIME]:'.bgRed, new Date().toUTCString())
  }

  _apiResHandler (method, apiRes) {
    this._logTime(method)

    const increaseCount = method === SYNC_API_METHODS.LEDGERS
      ? 2000
      : 300
    const offset = 50000

    const syncSchema = this._methodCollMap.get(method)
    const { type } = { ...syncSchema }

    if (
      method === SYNC_API_METHODS.CHANGE_LOGS ||
      type !== COLLS_TYPES.INSERTABLE_ARRAY_OBJECTS ||
      !apiRes ||
      typeof apiRes !== 'object' ||
      !Array.isArray(apiRes.res) ||
      apiRes.res.length === 0
    ) {
      return apiRes
    }

    const res = []

    for (const resItem of apiRes.res) {
      res.push(resItem)

      if (
        !resItem ||
        typeof resItem !== 'object' ||
        !Number.isInteger(resItem.id)
      ) {
        continue
      }

      const additionItem = new Array(increaseCount - 1)
        .fill()
        .map((v, i) => ({
          ...resItem,
          id: resItem.id + increaseCount + offset + i
        }))

      res.push(...additionItem)
    }

    apiRes.res = res

    return apiRes
  }

  async request (method, args, isCheckCall = false) {
    const apiRes = await this._requestToReportService(method, args)
    const handledApiRes = this._apiResHandler(method, apiRes)
    const res = await this._after(method, args, handledApiRes, isCheckCall)

    return res
  }

  _requestToReportService (method, args) {
    if (!this.hasMethod(method)) {
      throw new FindMethodError()
    }

    const fn = this.rService[method].bind(this.rService)

    return fn(args)
  }

  _after (method, args, apiRes, isCheckCall) {
    if (!this._hasHandlerAfter(method)) {
      return apiRes
    }

    const fn = this.apiMiddlewareHandlerAfter[method].bind(
      this.apiMiddlewareHandlerAfter
    )

    return fn(args, apiRes, isCheckCall)
  }
}

decorate(injectable(), ApiMiddleware)
decorate(inject(TYPES.RService), ApiMiddleware, 0)
decorate(inject(TYPES.ApiMiddlewareHandlerAfter), ApiMiddleware, 1)
decorate(inject(TYPES.SyncSchema), ApiMiddleware, 2)

module.exports = ApiMiddleware
