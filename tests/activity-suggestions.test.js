const assert = require('assert')
const { getActivitySuggestions, validSuggestions } = require('../packages/schedule/common/activitySuggestions')

const context = {
  participantCount: 3,
  date: '2026-07-04',
  sharedFreeSlots: [{ start: '15:00', end: '20:00', durationMinutes: 300 }],
  longestSlotMinutes: 300
}
const suggestions = getActivitySuggestions(context)
assert.strictEqual(suggestions.length, 3, 'local fallback provides three structured activities')
assert(suggestions.every((item) => item.estimatedMinutes <= 280), 'fallback leaves a 20-minute buffer')
assert.strictEqual(getActivitySuggestions(Object.assign({}, context, { longestSlotMinutes: 40 })).length, 0, 'very short slots do not produce unrealistic activities')
assert.strictEqual(validSuggestions(suggestions, 300).length, 3, 'well-formed AI suggestions can be accepted')
assert.strictEqual(validSuggestions([{ title: 'x', reason: 'y', estimatedMinutes: 300 }], 300), null, 'AI output must contain exactly three feasible items')
console.log('activity-suggestions.test.js: all assertions passed')
