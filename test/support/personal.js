// The setup the tests run against, in place of src/personal.js (see
// register.mjs). Reserved example.test hosts only.
export const T3_ORIGIN = "https://app.t3.codes";
export const FEED_BASE = "https://feeds.example.test/t3plus/";
export const TASKS_BASE = "https://tasks.example.test/";
export const ASSISTANT_GROUP = Object.freeze({
  botThreadId: "bot1",
  projectId: "p-ops",
  skipTitlePrefixes: Object.freeze(["Worker:"]),
});
export const IMMICH = Object.freeze({
  environmentId: "env-photos",
  projectId: "p-photos",
  feedEndpoint: `${FEED_BASE}t3plus-immich.json`,
  imageEndpoint: "https://photos.example.test/api/assets",
  libraryUrl: "https://photos.example.test/photos",
  maxPhotos: 4,
});
