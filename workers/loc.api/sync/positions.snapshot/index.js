'use strict'

const { isForexSymb } = require('../helpers')
const {
  decorate,
  injectable,
  inject
} = require('inversify')

const TYPES = require('../../di/types')

class PositionsSnapshot {
  constructor (
    rService,
    dao,
    ALLOWED_COLLS,
    syncSchema
  ) {
    this.rService = rService
    this.dao = dao
    this.ALLOWED_COLLS = ALLOWED_COLLS
    this.syncSchema = syncSchema
  }

  _getPositionsHistory (
    user,
    endMts,
    startMts
  ) {
    const positionsHistoryModel = this.syncSchema.getModelsMap()
      .get(this.ALLOWED_COLLS.POSITIONS_HISTORY)

    return this.dao.getElemsInCollBy(
      this.ALLOWED_COLLS.POSITIONS_HISTORY,
      {
        filter: {
          user_id: user._id,
          $lte: { mtsCreate: endMts },
          $gte: { mtsUpdate: startMts }
        },
        sort: [['mtsUpdate', -1]],
        projection: positionsHistoryModel,
        exclude: ['user_id'],
        isExcludePrivate: true
      }
    )
  }

  _findPositions (
    positionsAudit,
    reqStatus,
    year,
    month,
    day
  ) {
    return positionsAudit.find((posAudit) => {
      const { mtsUpdate, status } = { ...posAudit }

      if (!Number.isInteger(mtsUpdate)) {
        return false
      }

      const date = new Date(mtsUpdate)

      return (
        status === reqStatus &&
        year === date.getUTCFullYear() &&
        month === date.getUTCMonth() &&
        day === date.getUTCDate()
      )
    })
  }

  _findActivePositions (
    positionsAudit,
    year,
    month,
    day
  ) {
    return this._findPositions(
      positionsAudit,
      'ACTIVE',
      year,
      month,
      day
    )
  }

  _findClosedPositions (
    positionsAudit,
    year,
    month,
    day
  ) {
    return this._findPositions(
      positionsAudit,
      'CLOSED',
      year,
      month,
      day
    )
  }

  _getPositionsHistoryIds (positionsHistory) {
    return positionsHistory.reduce(
      (accum, { id } = {}) => {
        if (Number.isInteger(id)) {
          accum.push(id)
        }

        return accum
      }, [])
  }

  async _convertPlToUsd (
    pl,
    symbol,
    end
  ) {
    const currency = symbol.slice(-3)
    const _isForexSymb = isForexSymb(currency)

    if (
      currency === 'USD' &&
      Number.isFinite(pl)
    ) {
      return pl
    }
    if (
      _isForexSymb ||
      currency.length < 3 ||
      !Number.isFinite(pl)
    ) {
      return null
    }

    const reqSymb = `t${currency}USD`

    const {
      res: publicTrades
    } = await this.rService._getPublicTrades({
      params: {
        reqSymb,
        end,
        limit: 1,
        notThrowError: true,
        notCheckNextPage: true
      }
    })

    if (
      !Array.isArray(publicTrades) ||
      publicTrades.length === 0 ||
      !publicTrades[0] ||
      typeof publicTrades[0] !== 'object' ||
      !Number.isFinite(publicTrades[0].price)
    ) {
      return null
    }

    return pl * publicTrades[0].price
  }

  async _getCalculatedPositions (
    positions,
    end
  ) {
    const res = []

    for (const position of positions) {
      const {
        symbol,
        basePrice,
        amount
      } = { ...position }

      const resPositions = {
        ...position,
        actualPrice: null,
        pl: null,
        plUsd: null,
        plPerc: null
      }

      if (typeof symbol !== 'string') {
        res.push(resPositions)

        continue
      }

      const {
        res: publicTrades
      } = await this.rService._getPublicTrades({
        params: {
          symbol,
          end,
          limit: 1,
          notThrowError: true,
          notCheckNextPage: true
        }
      })

      if (
        !Array.isArray(publicTrades) ||
        publicTrades.length === 0 ||
        !publicTrades[0] ||
        typeof publicTrades[0] !== 'object' ||
        !Number.isFinite(publicTrades[0].price) ||
        !Number.isFinite(basePrice) ||
        !Number.isFinite(amount)
      ) {
        res.push(resPositions)

        continue
      }

      const actualPrice = publicTrades[0].price
      const pl = (actualPrice - basePrice) * Math.abs(amount)
      const plPerc = ((actualPrice / basePrice) - 1) * 100
      const plUsd = await this._convertPlToUsd(
        pl,
        symbol,
        end
      )

      res.push({
        ...resPositions,
        actualPrice,
        pl,
        plUsd,
        plPerc
      })
    }

    return res
  }

  _filterDuplicate (accum = [], curr = []) {
    if (
      !Array.isArray(accum) ||
      accum.length === 0
    ) {
      return [...curr]
    }

    const keys = Object.keys(accum[0]).filter(key => !/^_/.test(key))

    return curr.filter(currItem => {
      return accum.every(accumItem => {
        return keys.some(key => {
          return accumItem[key] !== currItem[key]
        })
      })
    })
  }

  async _getPositionsAudit (
    year,
    month,
    day,
    {
      auth = {},
      params: { ids } = {}
    } = {}
  ) {
    const positionsAudit = []

    for (const id of ids) {
      const singleIdRes = []

      let end = Date.now()
      let prevEnd = end
      let serialRequestsCount = 0

      while (true) {
        const _res = await this.rService.getPositionsAudit(
          null,
          { auth, params: { id: [id], end, limit: 250 } }
        )

        const { res, nextPage } = (
          Object.keys({ ..._res }).every(key => key !== 'nextPage')
        )
          ? { res: _res, nextPage: null }
          : _res

        prevEnd = end
        end = nextPage

        if (
          Array.isArray(res) &&
          res.length === 0 &&
          nextPage &&
          Number.isInteger(nextPage) &&
          serialRequestsCount < 1
        ) {
          serialRequestsCount += 1

          continue
        }

        serialRequestsCount = 0

        if (
          !Array.isArray(res) ||
          res.length === 0
        ) {
          break
        }

        const closedPos = this._findClosedPositions(
          res,
          year,
          month,
          day
        )

        if (
          closedPos &&
          typeof closedPos === 'object'
        ) {
          break
        }

        const activePos = this._findActivePositions(
          res,
          year,
          month,
          day
        )

        if (
          activePos &&
          typeof activePos === 'object'
        ) {
          positionsAudit.push(activePos)

          break
        }

        const resWithoutDuplicate = this._filterDuplicate(
          singleIdRes,
          res
        )
        singleIdRes.push(...resWithoutDuplicate)

        if (
          !Number.isInteger(nextPage) ||
          (
            resWithoutDuplicate.length === 0 &&
            end === prevEnd
          )
        ) {
          break
        }
      }
    }

    return positionsAudit
  }

  async getPositionsSnapshot (args) {
    const {
      auth = {},
      params = {}
    } = { ...args }
    const { end = Date.now() } = { ...params }
    const user = await this.dao.checkAuthInDb({ auth })

    const date = new Date(end)
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth()
    const day = date.getUTCDate()
    const startMts = Date.UTC(year, month, day)
    const endMts = Date.UTC(year, month, day + 1) - 1

    const positionsHistory = await this._getPositionsHistory(
      user,
      endMts,
      startMts
    )

    if (
      !Array.isArray(positionsHistory) ||
      positionsHistory.length === 0
    ) {
      return []
    }

    const ids = this._getPositionsHistoryIds(positionsHistory)
    const positionsAudit = await this._getPositionsAudit(
      year,
      month,
      day,
      { auth, params: { ids } }
    )

    if (
      !Array.isArray(positionsAudit) ||
      positionsAudit.length === 0
    ) {
      return []
    }

    const res = await this._getCalculatedPositions(
      positionsAudit,
      endMts
    )

    return res
  }
}

decorate(injectable(), PositionsSnapshot)
decorate(inject(TYPES.RService), PositionsSnapshot, 0)
decorate(inject(TYPES.DAO), PositionsSnapshot, 1)
decorate(inject(TYPES.ALLOWED_COLLS), PositionsSnapshot, 2)
decorate(inject(TYPES.SyncSchema), PositionsSnapshot, 3)

module.exports = PositionsSnapshot