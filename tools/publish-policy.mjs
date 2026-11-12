// Only these source paths may leave the private repository. New top-level
// directories stay private until deliberately added here.
const files = new Set([
  "AGENTS.md", "CLAUDE.md", "CHANGELOG.md", "LICENSE", "README.md", "ROADMAP.md",
  ".gitignore", "build.mjs", "manifest.base.json", "package.json", "package-lock.json",
  ".github/workflows/ci.yml", ".github/workflows/release.yml",
]);
const directories = new Set(["assets", "docs", "examples", "harness", "icons", "server", "src", "test", "tools"]);

export function isPublicPath(path) {
  const parts = path.split("/");
  if (parts.some((p) => /^(?:private|\.git|\.env(?:\..*)?|\.publish-deny|.*\.local\.json)$/i.test(p))) return false;
  if (/\.(?:pem|key|p12|pfx)$/i.test(path)) return false;
  return files.has(path) || (parts.length > 1 && directories.has(parts[0]));
}

export function parseDenyPatterns(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  if (!lines.length) throw new Error("Publishing needs at least one private-detail pattern in PUBLISH_DENY or .publish-deny.");
  return lines.map((line, i) => {
    try { return new RegExp(line, "i"); }
    catch { throw new Error(`Invalid private-detail pattern on entry ${i + 1}.`); }
  });
}

const builtIn = [
  /\b[a-z]:[\\/]+users[\\/]+(?!me\b|you\b)[a-z0-9._-]+/i,
  /[a-z0-9._%+-]+@(?!users\.noreply\.github\.com)[a-z0-9-]+\.[a-z0-9.-]*[a-z]{2,}/i,
];

/** Report locations only: private values and deny patterns must not enter logs. */
export function privateDetailLocations(where, text, deny) {
  return text.split(/\r?\n/).flatMap((line, i) =>
    [...deny, ...builtIn].some((pattern) => pattern.test(line)) ? [`${where}:${i + 1}`] : []);
}

export const needsVisualReview = (path, blob) => blob.includes(0) || /\.(?:svg|png|jpe?g|gif|webp|avif|ico|pdf)$/i.test(path);
