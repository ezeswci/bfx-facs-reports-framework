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
  isForexSymb
} = require('../helpers')

class FullTaxReport {
  constructor (
    dao,
    syncSchema,
    ALLOWED_COLLS,
    fullSnapshotReport,
    authenticator
  ) {
    this.dao = dao
    this.syncSchema = syncSchema
    this.ALLOWED_COLLS = ALLOWED_COLLS
    this.fullSnapshotReport = fullSnapshotReport
    this.authenticator = authenticator

    this.movementsModel = this.syncSchema.getModelsMap()
      .get(this.ALLOWED_COLLS.MOVEMENTS)
  }

  async _getMovements ({
    user = {},
    start = 0,
    end = Date.now()
  }) {
    const movements = await this.dao.getElemsInCollBy(
      this.ALLOWED_COLLS.MOVEMENTS,
      {
        filter: {
          $eq: { status: 'COMPLETED' },
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

    return Array.isArray(movements)
      ? movements
      : []
  }

  async _calcMovementsTotalAmount (movements) {
    if (
      !Array.isArray(movements) ||
      movements.length === 0
    ) {
      return null
    }

    const res = await movements.reduce(async (
      promise,
      movement = {},
      i
    ) => {
      const accum = await promise

      if ((i % 100) === 0) {
        await setImmediatePromise()
      }

      const { amount, amountUsd, currency } = { ...movement }
      const _isForexSymb = isForexSymb(currency)
      const _isNotUsedAmountUsdField = (
        _isForexSymb &&
        !Number.isFinite(amountUsd)
      )
      const _amount = _isNotUsedAmountUsdField
        ? amount
        : amountUsd
      const symb = _isNotUsedAmountUsdField
        ? currency
        : 'USD'

      if (!Number.isFinite(_amount)) {
        return { ...accum }
      }

      return {
        ...accum,
        [symb]: Number.isFinite(accum[symb])
          ? accum[symb] + _amount
          : _amount
      }
    }, {})
    const { USD } = { ...res }

    return USD
  }

  _getPeriodBalances (
    walletsTotalBalanceUsd,
    positionsTotalPlUsd
  ) {
    const _walletsTotalBalanceUsd = Number.isFinite(walletsTotalBalanceUsd)
      ? walletsTotalBalanceUsd
      : 0
    const _positionsTotalPlUsd = Number.isFinite(positionsTotalPlUsd)
      ? positionsTotalPlUsd
      : 0

    const totalResult = _walletsTotalBalanceUsd + _positionsTotalPlUsd

    return {
      walletsTotalBalanceUsd,
      positionsTotalPlUsd,
      totalResult
    }
  }

  _calcTotalResult (
    endingTotalResult,
    movementsTotalAmount,
    startingTotalResult
  ) {
    const _endingTotalResult = Number.isFinite(endingTotalResult)
      ? endingTotalResult
      : 0
    const _movementsTotalAmount = Number.isFinite(movementsTotalAmount)
      ? movementsTotalAmount
      : 0
    const _startingTotalResult = Number.isFinite(startingTotalResult)
      ? startingTotalResult
      : 0

    return _endingTotalResult - _movementsTotalAmount - _startingTotalResult
  }

  async getFullTaxReport ({
    auth = {},
    params: {
      start = 0,
      end = Date.now()
    } = {}
  } = {}) {
    const user = await this.authenticator
      .verifyRequestUser({ auth })

    const startingFullSnapshotPromise = this.fullSnapshotReport
      .getFullSnapshotReport({
        auth,
        params: { end: start }
      })
    const endingFullSnapshotPromise = this.fullSnapshotReport
      .getFullSnapshotReport({
        auth,
        params: { end }
      })
    const movements = await this._getMovements({
      user,
      start,
      end
    })
    const movementsTotalAmountPromise = this._calcMovementsTotalAmount(
      movements
    )

    const [
      startingFullSnapshot,
      endingFullSnapshot,
      movementsTotalAmount
    ] = await Promise.all([
      startingFullSnapshotPromise,
      endingFullSnapshotPromise,
      movementsTotalAmountPromise
    ])
    const {
      positionsSnapshot: startingPositionsSnapshot,
      walletsTotalBalanceUsd: startingWalletsTotalBalanceUsd,
      positionsTotalPlUsd: startingPositionsTotalPlUsd
    } = startingFullSnapshot
    const {
      positionsSnapshot: endingPositionsSnapshot,
      walletsTotalBalanceUsd: endingWalletsTotalBalanceUsd,
      positionsTotalPlUsd: endingPositionsTotalPlUsd
    } = endingFullSnapshot

    const startingPeriodBalances = this._getPeriodBalances(
      startingWalletsTotalBalanceUsd,
      startingPositionsTotalPlUsd
    )
    const endingPeriodBalances = this._getPeriodBalances(
      endingWalletsTotalBalanceUsd,
      endingPositionsTotalPlUsd
    )

    const {
      totalResult: endingTotalResult
    } = { ...endingPeriodBalances }
    const {
      totalResult: startingTotalResult
    } = { ...startingPeriodBalances }
    const totalResult = this._calcTotalResult(
      endingTotalResult,
      movementsTotalAmount,
      startingTotalResult
    )

    return {
      startingPositionsSnapshot,
      endingPositionsSnapshot,
      finalState: {
        startingPeriodBalances,
        movements,
        movementsTotalAmount,
        endingPeriodBalances,
        totalResult
      }
    }
  }
}

decorate(injectable(), FullTaxReport)
decorate(inject(TYPES.DAO), FullTaxReport, 0)
decorate(inject(TYPES.SyncSchema), FullTaxReport, 1)
decorate(inject(TYPES.ALLOWED_COLLS), FullTaxReport, 2)
decorate(inject(TYPES.FullSnapshotReport), FullTaxReport, 3)
decorate(inject(TYPES.Authenticator), FullTaxReport, 4)

module.exports = FullTaxReport
