/**
 * Where to go after signing in: a path on this site, never another origin.
 *
 * Checking how the text starts is not enough. Browsers drop tabs and newlines
 * from a URL and read "\" as "/", so "/\t/evil.com" passes a "not //" test and
 * then opens evil.com. Instead: refuse those characters outright, resolve the
 * path the way the browser will, and keep it only if it stays on this site.
 */
export function safeNext(next: unknown, fallback = "/account"): string {
  if (typeof next !== "string") return fallback;
  const path = next.slice(0, 500);
  if (!path.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(path)) return fallback;
  const base = "http://same-site.invalid";
  let url: URL;
  try {
    url = new URL(path, base);
  } catch {
    return fallback;
  }
  if (url.origin !== base) return fallback;
  const resolved = url.pathname + url.search + url.hash;
  // "/.//evil.com" resolves to the path "//evil.com", which a browser reads as another site.
  return resolved.startsWith("//") ? fallback : resolved;
}
