'use strict'

module.exports = class Context {
  constructor(transaction, segments) {
    this._transaction = transaction
    this._segments = segments || []
  }

  get segment() {
    return this._segments[this._segments.length - 1] || null
  }

  get transaction() {
    return this._transaction
  }

  addTransaction(transaction) {
    return new this.constructor(transaction, [transaction.trace.root])
  }
  addSegment(segment) {
    const segments = this._segments.slice()
    segments.push(segment)
    return new this.constructor(this._transaction, segments)
  }
}
