import assert from 'node:assert/strict'
import { isBotUserAgent } from '../src/utils/goBot.ts'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const FB_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.0.0;FBDV/iPhone15,2]'
const FB_IAB = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0.0.0.0]'
const INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0.0.0 (iPhone15,2; iOS 17_5; he_IL; he-IL; scale=3.00; 1179x2556)'

assert.equal(isBotUserAgent(''), true)
assert.equal(isBotUserAgent(null), true)
assert.equal(isBotUserAgent(undefined), true)
assert.equal(isBotUserAgent('   '), true)

assert.equal(isBotUserAgent('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'), true)
assert.equal(isBotUserAgent('WhatsApp/2.23.20.0'), true)
assert.equal(isBotUserAgent('curl/8.4.0'), true)
assert.equal(isBotUserAgent('facebookexternalhit/1.1', 'en-US'), true)

assert.equal(isBotUserAgent(IPHONE, 'he-IL,he;q=0.9'), false)
assert.equal(isBotUserAgent(ANDROID, 'he-IL'), false)
assert.equal(isBotUserAgent(IPHONE), false)
assert.equal(isBotUserAgent(FB_APP), false)
assert.equal(isBotUserAgent(FB_APP, ''), false)
assert.equal(isBotUserAgent(FB_IAB), false)
assert.equal(isBotUserAgent(INSTAGRAM), false)
assert.equal(isBotUserAgent(INSTAGRAM.toLowerCase()), false)

assert.equal(isBotUserAgent('CustomClient/1.0'), true)
assert.equal(isBotUserAgent('CustomClient/1.0', 'he-IL'), false)

console.log('go bot selfcheck ok')
