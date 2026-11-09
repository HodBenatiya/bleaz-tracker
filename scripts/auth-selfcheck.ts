import assert from 'node:assert/strict'
import { readBearer } from '../api/_auth'

assert.equal(readBearer({}), '')
assert.equal(readBearer({ headers: { authorization: 'Bearer abc.def.ghi' } }), 'abc.def.ghi')
assert.equal(readBearer({ headers: { Authorization: ['Bearer token-2'] } }), 'token-2')
assert.equal(readBearer({ headers: { authorization: 'Basic nope' } }), '')

console.log('auth selfcheck ok')
