# Floating browser preview

When T3 renders a floating **browser** preview, t3+ starts it in compact mode
directly below the thread-details card, aligned with its width (up to 400px).
**Expand** uses the upper chat column between the sidebar and thread details,
with a bounded height; **Compact** returns it below the card. Without thread
details, compact mode uses the top-right of the chat. If there is too little
room below the card, it falls back beside it to keep the page and controls
usable. The native close (X), open-in-right-panel
and supported pop-out controls stay visible. Closing dismisses the floating
view through T3's own button; it does not close the underlying browser tab.

The same browser surface stays mounted when switching modes. t3+ does not
change its URL, tab ID, browser viewport, controller, input handlers or session
state. Page clicks, scrolling, typing, touch, file choosers and browser dialogs
remain T3's responsibility. Only the frame's drag and resize gestures are
disabled. Device previews and previews already in the right panel are unchanged.

Tab reaches the Expand/Compact button and the native controls. Escape **from
those controls** compacts an expanded preview, or closes a compact preview.
Escape inside the browser page stays untouched, including T3's Shift+Escape
shortcut. Closing from the controls returns focus to the composer if T3 unmounts
the player and focus has not moved elsewhere.

Layout follows the chat column, composer height, find bar, sidebar, right panel,
window size and visual viewport (including the on-screen keyboard). The frame
uses T3's theme colors with visible keyboard focus. There are no resize
animations. With little vertical space, only the controls remain visible until
space returns. If even the control bar cannot fit, t3+ leaves T3's layout in
charge. Presentation choices are kept for up to 32 thread/tab pairs in this
page's memory, and reset on reload. Navigation, player removal and extension
shutdown release observers, event handlers and owned styles.

## Extension limits

This integration targets the DOM in
[ThreadPreviewMiniPlayer](https://github.com/pingdotgg/t3code/blob/9ef259e5/apps/web/src/components/preview/ThreadPreviewMiniPlayer.tsx)
and [ChatCanvas](https://github.com/pingdotgg/t3code/blob/9ef259e5/apps/web/src/components/chat/ChatCanvas.tsx).
Hooks live in `src/config.js`. If required controls or containers change, the
extension leaves the player native rather than disabling its controls.

- T3's internal canvas model still reserves space for its original mini-player
  geometry. t3+ cannot update that model through the DOM. The chat timeline can
  retain its original gutter or width, and an expanded preview covers messages
  rather than reflowing them. The header and composer remain accessible when
  enough room is available.
- The server-browser surface observes its displayed size and maps input itself,
  but the floating player uses `followSize={false}`. Expanding magnifies or
  letterboxes the existing browser viewport; it does not request a new remote
  viewport. Stream resolution, control ownership and reconnects remain native.
- Desktop-native browser surfaces are composited outside the DOM. t3+ cannot
  guarantee their clipping, stacking or input alignment after a CSS-only layout
  change, so players with a native browser surface slot are left unchanged.
  Browser-rendered server streams are the supported target; native pop-out
  windows and picture-in-picture retain T3's own presentation.
- T3 decides when the floating player exists. Opening the same source in the
  right panel, changing threads, permission changes or T3 session recovery may
  unmount it. t3+ does not force it back or override those actions. Session
  continuity across those native transitions belongs to T3.

`test/floatingPreview.test.js` covers geometry, stable surface identity, input
boundaries, native actions, mode isolation, discovery and cleanup using a
T3-shaped fixture. It does not certify the native compositor or a live remote
browser session.

The visual harness also renders a fake interactive browser page and captures
both presentations:

- [Compact top-right preview](floating-preview-compact.png)
- [Expanded chat-column preview](floating-preview-expanded.png)

It uses the same bundled content script and CSS as the extension; the page is
local fixture content and does not contact a real preview server.
