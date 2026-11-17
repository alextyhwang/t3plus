// The harness fixtures name the Assistant bot1, its project p-ops and its
// worker prefix "Worker:". When src/personal.js sets ASSISTANT_GROUP, fixtures
// are served with its ids swapped in; otherwise they are served as written.
import { ASSISTANT_GROUP } from "../src/personal.js";

export const withAssistantIds = (text) => !ASSISTANT_GROUP ? text : text
  .replaceAll("bot1", ASSISTANT_GROUP.botThreadId)
  .replaceAll("p-ops", ASSISTANT_GROUP.projectId)
  .replaceAll("Worker:", ASSISTANT_GROUP.skipTitlePrefixes[0]);
