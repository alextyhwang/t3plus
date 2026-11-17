# Why the Assistant group exists

The owner's T3 has two kinds of work, and the sidebar should keep them apart.

- **The bot workspace.** One personal project is run by bots. A router bot
  (the Assistant) takes each request and starts a top-level thread in that
  project for it. Those threads start their own sub-threads, and short-lived
  worker threads come and go. The owner talks to the Assistant and to the
  threads it started, not to the project as a list of tasks.
- **Everything else.** Regular code projects: branches, pull requests, reviews.
  T3's own list suits them as it ships: the inbox, the Working shelf, Snoozed
  and Settled. t3+ leaves that flow alone.

The Assistant group gives the bot workspace its own place without changing how
T3 handles the rest. The Assistant is the header. The threads it started sit
under it, out of the inbox. Workers that settle themselves stay out. A thread
that settles leaves the group for T3's Settled shelf, like any other thread.
Code threads never enter the group, and nothing about them changes.

What follows from this:

- **Membership is by project, not by title marker.** Every active top-level
  thread of the bot's project belongs to the group. Bots don't have to tag the
  threads they start.
- **Sections like T3's shelves.** The list reads the bots, always on top with no
  header (the Assistant with its threads under it, then the other bots), then the
  inbox in T3's own order, followed by T3's Working, Snoozed and Settled shelves.
  T3's own rows stay T3's: click, hover card,
  right-click menu and status keep working. The Assistant's threads are one
  line (title, agent icon, time): no project, branch or computer, because they
  all share the bot's project and machine.
- **The Assistant's row summarizes its threads.** Its second line prioritizes
  approvals and questions, then running work and the open-thread count. With
  nothing pending it says All caught up. Done checks stay on the threads.
  Folded, threads that want the owner (unread done, a question, failed) stay
  visible until read. Other bots show actionable status or their next scheduled update.
- **T3's shelves keep their threads.** A thread T3 moves to Working while it
  runs, or to Snoozed or Settled, stays there; worker threads stay in the inbox.
  Those rows read as the Assistant's: its name replaces the project name and
  the branch is hidden. The project's own T3 icon is a 16x16 pixel version of
  the Assistant's face (set in T3's project settings, file kept outside the
  project), so t3+ draws no face there.
- **One group, hardcoded for now.** The bot, its project and the worker title
  prefixes are `ASSISTANT_GROUP` in `src/personal.js`. More bots or projects can
  come later from `t3plus.json`, once one group has proven itself.
- **Read-only, like the rest of t3+.** The group never renames, pins, settles
  or moves anything in T3.

## How it works

- Membership: the Assistant's threads are the other active top-level threads of its
  project in T3's inbox, except worker threads whose title starts with one of
  `skipTitlePrefixes`.
- Order: T3's rows are reordered with CSS `order`, never DOM moves. The inbox follows
  the bots directly, with no header of its own.
- Feed: `server/publish_bot_feed.py` adds the sub-thread counts and the bot's state to
  `t3plus-bots.json`. When T3 renders no row for the bot (it settled and the Settled
  shelf is closed), t3+ draws one from that feed, so the bot stays on top even after
  T3 unpins or settles it.
- Fold state: the Assistant's open or closed state is remembered in this browser.
