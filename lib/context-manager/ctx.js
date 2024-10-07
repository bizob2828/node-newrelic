'use strict'
module.exports = class Context {
  constructor(segments, ctx, parentValues) {
    this._segments = segments || []
    this._ctx = ctx || []
    this._values = parentValues ? new Map(parentValues) : new Map()
  }

  getSegment() {
    return this._segments[this._segments.length - 1] 
  }

  getSpanContext() {
    return this._ctx[this._ctx.length - 1]
  }

  updateContext({ segment }) {
    if (!segment) {
      return this
    }
    const newSegments = this._segments.slice()
    newSegments.push(segment)
    const ctx = this._ctx.slice()
    const { traceId } = segment.transaction
    const spanId = segment.getSpanId()
    const traceFlags = segment.transaction.isSampled() ? 0x1 << 0 : 0x0 
    ctx.push({ traceId, spanId, traceFlags })
    return new this.constructor(newSegments, ctx, this._values)
  }

  getValue(key) {
    // for the bridge this is where we'd create a segment from the otel span
    return this._values.get(key);
  }

  setValue(key, value) {
    let rc
    if (key === 'otel-ctx') {
      const ctx = this._ctx.slice()
      ctx.push(value)
      // for the bridge this is where we'd create a segment from the otel span
      rc = new this.constructor(this._segments, ctx, this._values);
    } else {
      rc = new this.constructor(this._segments, this._ctx, this._values);
    }
    rc._values.set(key, value);
    return rc;
  }

  deleteValue(key) {
    const rc = new this.constructor(this._segments, this._ctx, this._values);
    rc._values.delete(key);
    return rc;
  }

}
