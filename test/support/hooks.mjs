const shipped = new URL("../../src/personal.js", import.meta.url).href;
const fixture = new URL("./personal.js", import.meta.url).href;

export async function resolve(specifier, context, next) {
  const resolved = await next(specifier, context);
  return resolved.url === shipped ? { ...resolved, url: fixture } : resolved;
}
