'use strict'

const crypto = require('crypto')
const { promisify } = require('util')
const {
  decorate,
  injectable,
  inject
} = require('inversify')
const {
  AuthError
} = require('bfx-report/workers/loc.api/errors')

const TYPES = require('../di/types')

const scrypt = promisify(crypto.scrypt)
const randomBytes = promisify(crypto.randomBytes)

class Authenticator {
  constructor (
    dao,
    TABLES_NAMES,
    CONF,
    rService
  ) {
    this.dao = dao
    this.TABLES_NAMES = TABLES_NAMES
    this.CONF = CONF
    this.rService = rService

    const { secretKey } = { ...this.CONF }
    this.secretKey = secretKey && typeof secretKey === 'string'
      ? secretKey
      : 'secretKey'
    this.algorithm = 'aes-256-gcm'

    /**
     * It may only work for one grenache worker instance
     */
    this.usersMap = new Map()
  }

  scrypt (secret, salt) {
    return scrypt(secret, salt, 64)
  }

  async encrypt (decryptedStr, password) {
    const key = await this.scrypt(password, this.secretKey)
    const iv = await randomBytes(16)
    const cipher = crypto.createCipheriv(this.algorithm, key, iv)

    const _encrypted = cipher.update(decryptedStr, 'utf8', 'hex')
    const encrypted = _encrypted + cipher.final('hex')
    const tag = cipher.getAuthTag()

    return `${iv.toString('hex')}.${encrypted}.${tag.toString('hex')}`
  }

  async decrypt (encryptedStr, password) {
    const [str, strIV, strTag] = encryptedStr.split('.')

    if (
      !str ||
      typeof str !== 'string' ||
      !strIV ||
      typeof strIV !== 'string' ||
      !strTag ||
      typeof strTag !== 'string'
    ) {
      throw new AuthError()
    }

    const key = await this.scrypt(password, this.secretKey)
    const iv = Buffer.from(strIV, 'hex')
    const tag = Buffer.from(strTag, 'hex')
    const decipher = crypto
      .createDecipheriv(this.algorithm, key, iv)
      .setAuthTag(tag)
    const _decrypted = decipher.update(str, 'hex', 'utf8')

    try {
      const decrypted = _decrypted + decipher.final('utf8')

      return decrypted
    } catch (err) {
      throw new AuthError()
    }
  }
}

decorate(injectable(), Authenticator)
decorate(inject(TYPES.DAO), Authenticator, 0)
decorate(inject(TYPES.TABLES_NAMES), Authenticator, 1)
decorate(inject(TYPES.CONF), Authenticator, 2)
decorate(inject(TYPES.RService), Authenticator, 3)

module.exports = Authenticator
