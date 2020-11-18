'use strict'

const { promisify } = require('util')
const setImmediatePromise = promisify(setImmediate)
const {
  decorate,
  injectable,
  inject
} = require('inversify')

const TYPES = require('../../di/types')
const {
  calcGroupedData,
  groupByTimeframe,
  getStartMtsByTimeframe,
  getBackIterable
} = require('../helpers')

class PerformingLoan {
  constructor (
    dao,
    ALLOWED_COLLS,
    syncSchema,
    FOREX_SYMBS,
    authenticator,
    SYNC_API_METHODS
  ) {
    this.dao = dao
    this.ALLOWED_COLLS = ALLOWED_COLLS
    this.syncSchema = syncSchema
    this.FOREX_SYMBS = FOREX_SYMBS
    this.authenticator = authenticator
    this.SYNC_API_METHODS = SYNC_API_METHODS

    this.tradesMethodColl = this.syncSchema.getMethodCollMap()
      .get(this.SYNC_API_METHODS.LEDGERS)
    this.ledgersModel = this.syncSchema.getModelsMap()
      .get(this.ALLOWED_COLLS.LEDGERS)
  }

  async _getLedgers ({
    auth,
    start,
    end,
    symbol,
    filter = {
      $eq: { _isMarginFundingPayment: 1 }
    },
    projection = this.ledgersModel
  }) {
    const user = await this.authenticator
      .verifyRequestUser({ auth })

    const symbFilter = (
      Array.isArray(symbol) &&
      symbol.length !== 0
    )
      ? { $in: { currency: symbol } }
      : {}

    return this.dao.getElemsInCollBy(
      this.ALLOWED_COLLS.LEDGERS,
      {
        filter: {
          ...filter,
          user_id: user._id,
          $lte: { mts: end },
          $gte: { mts: start },
          ...symbFilter
        },
        sort: [['mts', -1]],
        projection,
        exclude: ['user_id'],
        isExcludePrivate: true
      }
    )
  }

  _getFundingBalances ({
    auth,
    start,
    end,
    symbol,
    filter = {
      $eq: { wallet: 'funding' },
      $isNotNull: ['balance']
    }
  }) {
    return this._getLedgers({
      auth,
      start,
      end,
      symbol,
      filter,
      projection: ['mts', 'currency', 'balance']
    })
  }

  async _findMaxBalanceBetweenMtsFromStart (
    balances,
    {
      end,
      start,
      symbol
    }
  ) {
    let maxBalance = null

    for (const [i, ledger] of balances.entries()) {
      if ((i % 100) === 0) {
        await setImmediatePromise()
      }

      const {
        mts,
        currency,
        balance
      } = { ...ledger }

      if (mts < start) {
        break
      }
      if (
        mts > end ||
        currency !== symbol
      ) {
        continue
      }
      if (balance > maxBalance) {
        maxBalance = balance
      }
    }

    return maxBalance
  }

  async _findMaxBalanceBetweenMtsFromEnd (
    balances,
    {
      end,
      start,
      symbol
    }
  ) {
    const backIterableBalances = getBackIterable(balances)

    let maxBalance = null

    for (const [i, ledger] of backIterableBalances.entries()) {
      if ((i % 100) === 0) {
        await setImmediatePromise()
      }

      const {
        mts,
        currency,
        balance
      } = { ...ledger }

      if (mts > end) {
        break
      }
      if (
        mts < start ||
        currency !== symbol
      ) {
        continue
      }
      if (balance > maxBalance) {
        maxBalance = balance
      }
    }

    return maxBalance
  }

  _findMaxBalanceBetweenMts (
    balances = [],
    params = {}
  ) {
    const {
      end = Date.now(),
      start = 0,
      symbol
    } = { ...params }

    if (
      !Array.isArray(balances) ||
      balances.length === 0 ||
      !Number.isInteger(end) ||
      !Number.isInteger(start)
    ) {
      return null
    }

    const { mts: middleEntryMts } = balances[
      Math.trunc((balances.length - 1) / 2)
    ]
    const _params = {
      end,
      start,
      symbol
    }

    if (middleEntryMts > end) {
      return this._findMaxBalanceBetweenMtsFromEnd(
        balances,
        _params
      )
    }

    return this._findMaxBalanceBetweenMtsFromStart(
      balances,
      _params
    )
  }

  _calcPercsArr (percs) {
    if (
      !Array.isArray(percs) ||
      percs.length === 0 ||
      percs.some((item) => !Number.isFinite(item))
    ) {
      return null
    }

    const total = percs.reduce((accum, item) => {
      return accum + item
    }, 0)

    return total / percs.length
  }

  _isSameDay (prevMts, mts) {
    return getStartMtsByTimeframe(prevMts, 'day') === getStartMtsByTimeframe(mts, 'day')
  }

  _calcPerc (amount, balance) {
    if (
      !Number.isFinite(amount) ||
      !Number.isFinite(balance)
    ) {
      return 0
    }

    return (Math.pow(1 + amount / balance, 365) - 1) * 100
  }

  async _calcDailyPercs (data, balances) {
    let prevMts = 0

    const percsGroupedByDays = await data.reduce(
      async (promise, ledger = {}, i) => {
        const accum = await promise

        if ((i % 100) === 0) {
          await setImmediatePromise()
        }

        const { amount, mts, currency } = { ...ledger }
        const maxBalance = await this._findMaxBalanceBetweenMts(
          balances,
          {
            end: mts,
            start: Number.isInteger(mts)
              /* Used 30h instead of 24h as might have overlaps */
              ? mts - 30 * 60 * 60 * 1000
              : null,
            symbol: currency
          }
        )

        if (
          accum.length !== 0 &&
          this._isSameDay(prevMts, mts)
        ) {
          accum[accum.length - 1].push(
            this._calcPerc(amount, maxBalance)
          )
          prevMts = mts

          return accum
        }

        accum.push([this._calcPerc(amount, maxBalance)])
        prevMts = mts

        return accum
      },
      []
    )

    const res = []

    for (const [i, percs] of percsGroupedByDays.entries()) {
      if ((i % 100) === 0) {
        await setImmediatePromise()
      }

      res.push(this._calcPercsArr(percs))
    }

    return res
  }

  _calcLedgers (balances) {
    return async (data = []) => {
      const res = await data.reduce(async (promise, ledger = {}, i) => {
        const accum = await promise

        if ((i % 100) === 0) {
          await setImmediatePromise()
        }

        const { amountUsd } = { ...ledger }

        if (!Number.isFinite(amountUsd)) {
          return { ...accum }
        }

        return {
          ...accum,
          USD: Number.isFinite(accum.USD)
            ? accum.USD + amountUsd
            : amountUsd
        }
      }, {})
      const dailyPercs = await this._calcDailyPercs(data, balances)

      return {
        ...res,
        dailyPercs
      }
    }
  }

  _calcAmountPerc (ledgersGroupedByTimeframe) {
    const { dailyPercs = [] } = {
      ...ledgersGroupedByTimeframe
    }

    return this._calcPercsArr(dailyPercs)
  }

  _calcPrevAmount (res, cumulative) {
    const { USD: amount } = { ...res }

    return (
      Number.isFinite(amount) &&
      Number.isFinite(cumulative)
    )
      ? amount + cumulative
      : cumulative
  }

  _getLedgersByTimeframe () {
    let cumulative = 0

    return ({ ledgersGroupedByTimeframe = {}, mts }) => {
      const ledgersArr = Object.entries(ledgersGroupedByTimeframe)
      const res = ledgersArr.reduce((
        accum,
        [symb, amount]
      ) => {
        if (
          symb !== 'USD' ||
          !Number.isFinite(amount)
        ) {
          return { ...accum }
        }

        return {
          ...accum,
          [symb]: amount
        }
      }, {})
      const perc = this._calcAmountPerc(ledgersGroupedByTimeframe)
      cumulative = this._calcPrevAmount(res, cumulative)

      return {
        cumulative,
        perc,
        ...res
      }
    }
  }

  async getPerformingLoan (
    {
      auth = {},
      params = {}
    } = {}
  ) {
    const {
      start = 0,
      end = Date.now(),
      timeframe = 'day',
      symbol: symbs
    } = { ...params }
    const _symbol = Array.isArray(symbs)
      ? symbs
      : [symbs]
    const symbol = _symbol.filter((s) => (
      s && typeof s === 'string'
    ))
    const args = {
      auth,
      start,
      end,
      symbol
    }

    const ledgers = await this._getLedgers(args)
    const balances = await this._getFundingBalances(args)

    const {
      dateFieldName: ledgersDateFieldName,
      symbolFieldName: ledgersSymbolFieldName
    } = this.tradesMethodColl

    const ledgersGroupedByTimeframe = await groupByTimeframe(
      ledgers,
      { timeframe, start, end },
      this.FOREX_SYMBS,
      ledgersDateFieldName,
      ledgersSymbolFieldName,
      this._calcLedgers(balances)
    )

    const groupedData = await calcGroupedData(
      { ledgersGroupedByTimeframe },
      false,
      this._getLedgersByTimeframe(),
      true
    )

    return groupedData
  }
}

decorate(injectable(), PerformingLoan)
decorate(inject(TYPES.DAO), PerformingLoan, 0)
decorate(inject(TYPES.ALLOWED_COLLS), PerformingLoan, 1)
decorate(inject(TYPES.SyncSchema), PerformingLoan, 2)
decorate(inject(TYPES.FOREX_SYMBS), PerformingLoan, 3)
decorate(inject(TYPES.Authenticator), PerformingLoan, 4)
decorate(inject(TYPES.SYNC_API_METHODS), PerformingLoan, 5)

module.exports = PerformingLoan
