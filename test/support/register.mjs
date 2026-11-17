// `npm test` loads this first (node --import). Modules that import
// src/personal.js get test/support/personal.js instead, so the tests exercise
// configured feeds, tasks, the Assistant group and Immich with example hosts.
// A specifier ending in "?shipped" (test/manifest.test.js) reads the real file.
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
