import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./resolve-ts-specifier.mjs', import.meta.url)
await import('./go-redirect-selfcheck.ts')
