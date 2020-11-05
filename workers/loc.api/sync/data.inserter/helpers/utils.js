'use strict'

const { promisify } = require('util')
const setImmediatePromise = promisify(setImmediate)
const {
  pick
} = require('lodash')
const { push } = require('../../helpers/forex-symbs')

const normalizeApiData = async (
  data = [],
  model,
  parser = () => {}
) => {
  if (
    !model ||
    typeof model !== 'object'
  ) {
    return data
  }

  const modelKeys = Object.keys(model)

  if (modelKeys.length === 0) {
    return data
  }

  const res = []

  for (const item of data) {
    if (
      !item ||
      typeof item !== 'object'
    ) {
      return push(item)
    }

    await setImmediatePromise()

    parser(item)
    res.push(pick(item, modelKeys))
  }

  return res
}

const getAuthFromDb = (authenticator) => {
  const auth = new Map()
  const sessions = authenticator.getUserSessions()

  if (sessions.size === 0) {
    return auth
  }

  for (const [, session] of sessions) {
    const {
      _id,
      email,
      apiKey,
      apiSecret,
      isSubAccount,
      subUsers,
      token
    } = { ...session }
    const authPayload = {
      _id,
      email,
      apiKey,
      apiSecret,
      isSubAccount,
      subUsers,
      token,
      subUser: null
    }

    if (!isSubAccount) {
      auth.set(apiKey, authPayload)

      continue
    }
    if (
      !Array.isArray(subUsers) ||
      subUsers.length === 0
    ) {
      continue
    }

    subUsers.forEach((subUser) => {
      const { apiKey: subUserApiKey } = { ...subUser }

      auth.set(
        `${apiKey}-${subUserApiKey}`,
        { ...authPayload, subUser }
      )
    })
  }

  return auth
}

const getAllowedCollsNames = (allowedColls) => {
  return Object.values(allowedColls)
    .filter(name => !(/^_.*/.test(name)))
}

module.exports = {
  normalizeApiData,
  getAuthFromDb,
  getAllowedCollsNames
}
