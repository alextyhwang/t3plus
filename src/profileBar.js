import { T3PLUS } from "./config.js";
import { createBuilder, setText } from "./dom.js";
import { ALL_PROFILE_ID } from "./profiles.js";
import { CONFIG_SOURCES } from "./remoteConfig.js";

/**
 * The profile strip: one small segmented control (All + profiles) inserted
 * under T3's sidebar header, plus a tiny source/diagnostic button. Built once;
 * update() rebuilds buttons only when the profile list changes, so focus
 * survives the DOM watcher's re-runs.
 *
 * actions: { selectProfile(id), refreshConfig() }
 */
export function createProfileBar(doc, actions) {
  const h = createBuilder(doc);
  const tabs = h("div", { class: "t3plus-profile-tabs", role: "group", "aria-label": "t3+ profiles" });
  const status = h("button", { type: "button", class: "t3plus-profile-status", "aria-label": "t3+ profile source" });
  status.addEventListener("click", () => actions.refreshConfig());
  const element = h("nav", { id: T3PLUS.profileBarId, class: "t3plus-profilebar", "aria-label": "t3+" }, [
    h("div", { class: "t3plus-profilebar-row" }, [tabs, status]),
  ]);

  let tabSignature = "";
  const tabButtons = new Map();

  function renderTabs(profiles) {
    tabButtons.clear();
    const all = [{ id: ALL_PROFILE_ID, label: "All", color: null }, ...profiles];
    tabs.replaceChildren(
      ...all.map((profile) => {
        const dot = profile.color ? h("span", { class: "t3plus-profile-dot", "aria-hidden": "true" }) : null;
        dot?.style.setProperty("--t3plus-profile-color", profile.color);
        const button = h("button", { type: "button", class: "t3plus-profile-tab", "data-profile-id": profile.id }, [
          dot,
          h("span", { class: "t3plus-profile-label", text: profile.label }),
        ]);
        button.addEventListener("click", () => actions.selectProfile(profile.id));
        tabButtons.set(profile.id, button);
        return button;
      }),
    );
  }

  /**
   * state: {
   *   profiles: [{ id, label, color }], activeId,
   *   source, diagnostic, errors: string[],
   *   emptyProfile: boolean,
   * }
   */
  function update(state) {
    const nextTabs = JSON.stringify(state.profiles.map((p) => [p.id, p.label, p.color]));
    if (nextTabs !== tabSignature) {
      tabSignature = nextTabs;
      renderTabs(state.profiles);
    }
    for (const [id, button] of tabButtons) {
      const pressed = String(id === state.activeId);
      if (button.getAttribute("aria-pressed") !== pressed) button.setAttribute("aria-pressed", pressed);
    }

    const problem = state.source === "none" || (state.source === "cache" && Boolean(state.diagnostic)) || state.errors.length > 0;
    const statusText = [CONFIG_SOURCES[state.source]?.status, state.diagnostic, ...state.errors.slice(0, 3), "Click to reload."]
      .filter(Boolean)
      .join("\n");
    if (status.title !== statusText) status.title = statusText;
    const statusAttr = problem ? "warn" : "ok";
    if (status.dataset.state !== statusAttr) status.dataset.state = statusAttr;
    setText(status, problem ? "!" : "");
    const empty = state.emptyProfile ? "true" : "false";
    if (element.dataset.empty !== empty) element.dataset.empty = empty;
  }

  return { element, update };
}
