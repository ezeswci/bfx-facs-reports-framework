'use strict'

const { promisify } = require('util')
const setImmediatePromise = promisify(setImmediate)
const moment = require('moment')
const {
  decorate,
  injectable,
  inject
} = require('inversify')

const TYPES = require('../../di/types')
const {
  calcGroupedData,
  groupByTimeframe,
  isForexSymb,
  getStartMtsByTimeframe
} = require('../helpers')

class WinLoss {
  constructor (
    dao,
    syncSchema,
    ALLOWED_COLLS,
    wallets,
    balanceHistory,
    positionsSnapshot,
    FOREX_SYMBS,
    authenticator,
    SYNC_API_METHODS
  ) {
    this.dao = dao
    this.syncSchema = syncSchema
    this.ALLOWED_COLLS = ALLOWED_COLLS
    this.wallets = wallets
    this.balanceHistory = balanceHistory
    this.positionsSnapshot = positionsSnapshot
    this.FOREX_SYMBS = FOREX_SYMBS
    this.authenticator = authenticator
    this.SYNC_API_METHODS = SYNC_API_METHODS

    this.movementsModel = this.syncSchema.getModelsMap()
      .get(this.ALLOWED_COLLS.MOVEMENTS)
    this.movementsMethodColl = this.syncSchema.getMethodCollMap()
      .get(this.SYNC_API_METHODS.MOVEMENTS)
    this.movementsSymbolFieldName = this.movementsMethodColl.symbolFieldName
  }

  async _getPlFromPositionsSnapshot (args) {
    const positionsSnapshot = await this.positionsSnapshot
      .getSyncedPositionsSnapshot(args)

    if (
      !Array.isArray(positionsSnapshot) ||
      positionsSnapshot.length === 0
    ) {
      return null
    }

    return positionsSnapshot.reduce(async (promise, curr, i) => {
      const accum = await promise

      if ((i % 100) === 0) {
        await setImmediatePromise()
      }

      const { plUsd } = { ...curr }
      const symb = 'USD'

      if (!Number.isFinite(plUsd)) {
        return accum
      }

      return {
        ...accum,
        [symb]: Number.isFinite(accum[symb])
          ? accum[symb] + plUsd
          : plUsd
      }
    }, {})
  }

  _sumMovementsWithPrevRes (
    prevMovementsRes,
    withdrawalsGroupedByTimeframe,
    depositsGroupedByTimefram
  ) {
    return this.FOREX_SYMBS.reduce((accum, symb) => {
      const prevMovement = Number.isFinite(prevMovementsRes[symb])
        ? prevMovementsRes[symb]
        : 0
      const withdrawals = Number.isFinite(withdrawalsGroupedByTimeframe[symb])
        ? withdrawalsGroupedByTimeframe[symb]
        : 0
      const deposits = Number.isFinite(depositsGroupedByTimefram[symb])
        ? depositsGroupedByTimefram[symb]
        : 0
      const res = prevMovement + withdrawals + deposits

      return {
        ...accum,
        [symb]: res
      }
    }, {})
  }

  _getWinLossByTimeframe (
    startWalletsVals = {},
    startPl = {},
    endPl = {}
  ) {
    let prevMovementsRes = {}

    return ({
      walletsGroupedByTimeframe = {},
      withdrawalsGroupedByTimeframe = {},
      depositsGroupedByTimeframe = {}
    } = {}, i) => {
      const isLast = i === 0
      const _startPl = { ...startPl }
      const _endPl = isLast ? { ...endPl } : {}

      prevMovementsRes = this._sumMovementsWithPrevRes(
        prevMovementsRes,
        { ...withdrawalsGroupedByTimeframe },
        { ...depositsGroupedByTimeframe }
      )

      return this.FOREX_SYMBS.reduce((accum, symb) => {
        const startWallet = Number.isFinite(startWalletsVals[symb])
          ? startWalletsVals[symb]
          : 0
        const wallet = Number.isFinite(walletsGroupedByTimeframe[symb])
          ? walletsGroupedByTimeframe[symb]
          : 0
        const movements = Number.isFinite(prevMovementsRes[symb])
          ? prevMovementsRes[symb]
          : 0
        const _startPlVal = Number.isFinite(_startPl[symb])
          ? _startPl[symb]
          : 0
        const _endPlVal = Number.isFinite(_endPl[symb])
          ? _endPl[symb]
          : 0
        const res = (wallet - startWallet - movements) +
          (_startPlVal + _endPlVal)

        if (!res) {
          return { ...accum }
        }

        return {
          ...accum,
          [symb]: res
        }
      }, {})
    }
  }

  _calcMovements (
    data = [],
    symbolFieldName,
    symbol = []
  ) {
    return data.reduce(async (promise, movement = {}, i) => {
      const accum = await promise

      if ((i % 100) === 0) {
        await setImmediatePromise()
      }

      const { amount, amountUsd } = { ...movement }
      const currSymb = movement[symbolFieldName]
      const _isForexSymb = isForexSymb(currSymb, symbol)
      const _isNotUsedAmountUsdField = (
        _isForexSymb &&
        !Number.isFinite(amountUsd)
      )
      const _amount = _isNotUsedAmountUsdField
        ? amount
        : amountUsd
      const symb = _isNotUsedAmountUsdField
        ? currSymb
        : 'USD'

      if (!Number.isFinite(_amount)) {
        return { ...accum }
      }

      return {
        ...accum,
        [symb]: (Number.isFinite(accum[symb]))
          ? accum[symb] + _amount
          : _amount
      }
    }, {})
  }

  _getStartWallets () {
    return this.FOREX_SYMBS.reduce((accum, symb) => {
      return {
        ...accum,
        [symb]: 0
      }
    }, {})
  }

  _calcFirstWallets (
    data = [],
    startWallets = {}
  ) {
    return data.reduce((accum, movement = {}) => {
      const { balance, balanceUsd, currency } = { ...movement }
      const _isForexSymb = isForexSymb(currency, this.FOREX_SYMBS)
      const _isNotUsedBalanceUsdField = (
        _isForexSymb &&
        !Number.isFinite(balanceUsd)
      )
      const _balance = _isNotUsedBalanceUsdField
        ? balance
        : balanceUsd
      const symb = _isNotUsedBalanceUsdField
        ? currency
        : 'USD'

      if (!Number.isFinite(_balance)) {
        return { ...accum }
      }

      return {
        ...accum,
        [symb]: (Number.isFinite(accum[symb]))
          ? accum[symb] + _balance
          : _balance
      }
    }, startWallets)
  }

  async _shiftMtsToNextTimeframe (
    groupedData,
    timeframe
  ) {
    const res = []

    for (const [i, item] of groupedData.entries()) {
      if ((i % 100) === 0) {
        await setImmediatePromise()
      }
      if (
        i === (groupedData.length - 1) ||
        i === 0
      ) {
        res.push({ ...item })

        continue
      }

      const normalizedMtsByTimeframe = getStartMtsByTimeframe(
        item.mts,
        timeframe
      )
      const mtsMoment = moment.utc(normalizedMtsByTimeframe)

      if (timeframe === 'day') {
        mtsMoment.add(1, 'days')
      }
      if (timeframe === 'month') {
        mtsMoment.add(1, 'months')
      }
      if (timeframe === 'year') {
        mtsMoment.add(1, 'years')
      }

      const mts = mtsMoment.valueOf()

      res.push({ ...item, mts })
    }

    return res
  }

  async getWinLoss ({
    auth = {},
    params = {}
  } = {}) {
    const user = await this.authenticator
      .verifyRequestUser({ auth })

    const {
      timeframe = 'day',
      start = 0,
      end = Date.now()
    } = { ...params }
    const args = {
      auth,
      params: {
        timeframe,
        start,
        end
      }
    }

    const walletsGroupedByTimeframePromise = this.balanceHistory
      .getBalanceHistory(
        args,
        true
      )
    const firstWalletsPromise = this.wallets.getWallets({
      auth,
      params: { end: start }
    })

    const startPlPromise = this._getPlFromPositionsSnapshot({
      auth,
      params: { start }
    })
    const endPlPromise = this._getPlFromPositionsSnapshot({
      auth,
      params: { end }
    })

    const withdrawalsPromise = this.dao.getElemsInCollBy(
      this.ALLOWED_COLLS.MOVEMENTS,
      {
        filter: {
          $not: { status: 'CANCELED' },
          $lt: { amount: 0 },
          $gte: { mtsStarted: start },
          $lte: { mtsStarted: end },
          user_id: user._id
        },
        sort: [['mtsStarted', -1]],
        projection: this.movementsModel,
        exclude: ['user_id'],
        isExcludePrivate: true
      }
    )
    const depositsPromise = this.dao.getElemsInCollBy(
      this.ALLOWED_COLLS.MOVEMENTS,
      {
        filter: {
          status: 'COMPLETED',
          $gt: { amount: 0 },
          $gte: { mtsUpdated: start },
          $lte: { mtsUpdated: end },
          user_id: user._id
        },
        sort: [['mtsUpdated', -1]],
        projection: this.movementsModel,
        exclude: ['user_id'],
        isExcludePrivate: true
      }
    )

    const [
      withdrawals,
      deposits,
      firstWallets,
      startPl,
      endPl
    ] = await Promise.all([
      withdrawalsPromise,
      depositsPromise,
      firstWalletsPromise,
      startPlPromise,
      endPlPromise
    ])

    const withdrawalsGroupedByTimeframePromise = groupByTimeframe(
      withdrawals,
      { timeframe, start, end },
      this.FOREX_SYMBS,
      'mtsStarted',
      this.movementsSymbolFieldName,
      this._calcMovements.bind(this)
    )
    const depositsGroupedByTimeframePromise = groupByTimeframe(
      deposits,
      { timeframe, start, end },
      this.FOREX_SYMBS,
      'mtsUpdated',
      this.movementsSymbolFieldName,
      this._calcMovements.bind(this)
    )

    const [
      withdrawalsGroupedByTimeframe,
      depositsGroupedByTimeframe,
      walletsGroupedByTimeframe
    ] = await Promise.all([
      withdrawalsGroupedByTimeframePromise,
      depositsGroupedByTimeframePromise,
      walletsGroupedByTimeframePromise
    ])

    const startWallets = this._getStartWallets()
    const startWalletsInForex = this._calcFirstWallets(
      firstWallets,
      startWallets
    )

    const groupedData = await calcGroupedData(
      {
        walletsGroupedByTimeframe,
        withdrawalsGroupedByTimeframe,
        depositsGroupedByTimeframe
      },
      false,
      this._getWinLossByTimeframe(
        startWalletsInForex,
        startPl,
        endPl
      ),
      true
    )
    groupedData.push({
      mts: start,
      USD: 0
    })
    const res = await this._shiftMtsToNextTimeframe(
      groupedData,
      timeframe
    )

    return res
  }
}

decorate(injectable(), WinLoss)
decorate(inject(TYPES.DAO), WinLoss, 0)
decorate(inject(TYPES.SyncSchema), WinLoss, 1)
decorate(inject(TYPES.ALLOWED_COLLS), WinLoss, 2)
decorate(inject(TYPES.Wallets), WinLoss, 3)
decorate(inject(TYPES.BalanceHistory), WinLoss, 4)
decorate(inject(TYPES.PositionsSnapshot), WinLoss, 5)
decorate(inject(TYPES.FOREX_SYMBS), WinLoss, 6)
decorate(inject(TYPES.Authenticator), WinLoss, 7)
decorate(inject(TYPES.SYNC_API_METHODS), WinLoss, 8)

module.exports = WinLoss
