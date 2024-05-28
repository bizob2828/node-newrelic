'use strict'

module.exports = function messageRecorder(rollupMetric, segment, scope) {
  const duration = segment.getDurationInMillis()
  const exclusive = segment.getExclusiveDurationInMillis()
  const transaction = segment.transaction

  if (scope) {
    transaction.measure(segment.name, scope, duration, exclusive)
    transaction.measure(rollupMetric, scope, duration, exclusive)
  }

  transaction.measure(segment.name, null, duration, exclusive)
  transaction.measure(rollupMetric, null, duration, exclusive)
}
