import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { crc32, inflateRawSync } from "node:zlib";
import { writeZip } from "../tools/zip.mjs";

/** Reads every entry back through the central directory. */
function readZip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = inflateRawSync(buf.subarray(dataAt, dataAt + size));
    assert.equal(crc32(data), crc, `${name} checksum`);
    out.set(name, data.toString("utf8"));
    at += 46 + nameLen;
  }
  return out;
}

test("release zips hold every file under one folder, with forward slashes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "t3plus-zip-"));
  try {
    await mkdir(join(dir, "src", "icons"), { recursive: true });
    await writeFile(join(dir, "src", "manifest.json"), '{"name":"t3+"}');
    await writeFile(join(dir, "src", "icons", "a.txt"), "x".repeat(5000));
    await writeZip(join(dir, "src"), "t3plus-v1.0.0", join(dir, "out.zip"));
    const entries = readZip(await readFile(join(dir, "out.zip")));
    assert.deepEqual([...entries.keys()].sort(), ["t3plus-v1.0.0/icons/a.txt", "t3plus-v1.0.0/manifest.json"]);
    assert.equal(entries.get("t3plus-v1.0.0/manifest.json"), '{"name":"t3+"}');
    assert.equal(entries.get("t3plus-v1.0.0/icons/a.txt").length, 5000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
