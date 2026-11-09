import assert from 'node:assert/strict'
import { contentDisposition, cvStorageKey, downloadFileName, storageObjectName, storageObjectPath, waMediaObjectPath } from '../src/utils/storageKey'

const owner = '11111111-2222-4333-8444-555555555555'
const now = 1700000000000

assert.equal(cvStorageKey(owner, 'קורות חיים.pdf', now), `${owner}/${now}-cv.pdf`)
assert.equal(cvStorageKey(owner, 'my cv final.docx', now), `${owner}/${now}-my-cv-final.docx`)
assert.equal(cvStorageKey(owner, 'my cv', now), `${owner}/${now}-my-cv`)
assert.equal(cvStorageKey(owner, 'קורות.pages', now), `${owner}/${now}-cv.pages`)
assert.equal(cvStorageKey(owner, 'My CV.PDF', now), `${owner}/${now}-my-cv.pdf`)
assert.equal(cvStorageKey(owner, '   ', now), `${owner}/${now}-cv`)
assert.equal(cvStorageKey(owner, '../../etc/passwd', now), `${owner}/${now}-passwd`)
assert.equal(cvStorageKey('לא-תקין', 'קורות חיים.pdf', now), `cv/${now}-cv.pdf`)
assert.doesNotMatch(cvStorageKey(owner, 'קורות חיים (סופי)!.PDF', now), /[^\x00-\x7F\s]| /)
assert.equal(cvStorageKey(owner, 'קורות חיים (סופי)!.PDF', now), `${owner}/${now}-cv.pdf`)

assert.equal(storageObjectName('voice note.WEBM', 'file'), 'voice-note.webm')
assert.equal(waMediaObjectPath('521234567', 'קורות חיים.pdf', now), `whatsapp/521234567/${now}-file.pdf`)
assert.equal(waMediaObjectPath('', 'תמונה.jpg', now), `whatsapp/file/${now}-file.jpg`)

assert.equal(downloadFileName('קורות חיים.pdf'), 'קורות חיים.pdf')
assert.equal(downloadFileName('a/../../קורות חיים.pdf'), 'קורות חיים.pdf')
const header = contentDisposition('attachment', 'קורות חיים.pdf')
assert.match(header, /^attachment; filename="_____ ____\.pdf"; filename\*=UTF-8''/)
assert.match(header, /%D7%A7/)

const legacyCv = storageObjectPath('cvs:old-id-170000-קורות חיים.pdf')
assert.equal(legacyCv?.bucket, 'cvs')
assert.equal(legacyCv?.path, 'old-id-170000-קורות חיים.pdf')
const legacyWa = storageObjectPath('wa-media:whatsapp/521234567/170000-קורות חיים.pdf')
assert.equal(legacyWa?.bucket, 'wa-media')
assert.equal(legacyWa?.path, 'whatsapp/521234567/170000-קורות חיים.pdf')
const hosted = storageObjectPath('https://example.supabase.co/storage/v1/object/sign/cvs/old%20name.pdf?token=abc')
assert.equal(hosted?.path, 'old name.pdf')

console.log('storage key selfcheck ok')
