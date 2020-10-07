'use strict'

module.exports = () => {
  return `SELECT name FROM sqlite_master
  WHERE type='table' AND
  name NOT LIKE 'sqlite_%'
  ORDER BY name`
}
