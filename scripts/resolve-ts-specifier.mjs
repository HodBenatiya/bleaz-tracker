// Lets node --experimental-strip-types load the api/*.ts files, which import
// sibling modules with a .js suffix (the Vercel bundle convention).
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.js')) {
    try {
      return await nextResolve(`${specifier.slice(0, -3)}.ts`, context)
    } catch {
      // A real .js dependency (node_modules) resolves below.
    }
  }
  return nextResolve(specifier, context)
}
