# Calendar in draft details

## Scope and placement

The calendar is a read-only section for the Assistant group's project
(`ASSISTANT_GROUP.projectId` in `src/personal.js`) and the environment the bot feed
reports for it. The active draft's persisted identity supplies membership. Saved
threads and other projects never mount it or request the agenda. Closing details,
replacing its host, changing draft identity, or stopping the extension discards the
view and its payload.

It sits in the existing measured native details host, immediately above Tasks. The
agenda shows one day at a time: today if it has upcoming events, otherwise the next
date with events. Previous/next buttons navigate civil days through the next seven
days, including empty dates. The selected weekday/date is the header and links to
Google Calendar; the navigation arrows and refresh sit alongside it. Current time in
the source timezone appears below the date and updates on the existing minute tick.
Up to 50 normalized events are retained for this navigation; all-day spans appear on
each included day.

The section has a bounded height, leaving Tasks as the scrolling region. The native
details ScrollArea remains the fallback on short viewports. The lowest-home-widget
alignment, native controls and shared composer material are retained. The section
adds no background layer, gradient, dither or theme preference.

## Source contract

The calendar uses only `GET api/tasks/calendar/agenda` on the task service
(`CALENDAR_AGENDA_ENDPOINT` in `src/hosts.js`). The extension worker attaches that
service's normal cookie session. OAuth stays in the server service; the extension
contains no Google credentials. Expected response:

```json
{
  "timeZone": "Etc/UTC",
  "updatedAt": "2030-01-01T09:00:00Z",
  "items": [
    {"id":"synthetic-instance", "summary":"Example event", "status":"confirmed",
     "start":{"dateTime":"2030-01-01T10:00:00Z"},
     "end":{"dateTime":"2030-01-01T11:00:00Z"}}
  ]
}
```

The service returns up to 50 upcoming expanded instances in the next seven days,
using Google's `singleEvents=true`, `orderBy=startTime`, bounded `timeMin` /
`timeMax`, and read-only access. It returns no descriptions, attendees or location.
Cancelled events are ignored, ongoing events retained, duplicate ids removed,
recurring masters rejected. All-day `date` ends are exclusive and stay civil dates;
timed events require explicit RFC3339 offsets and display in the source IANA zone.
Google semantics were checked against the
[events.list reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/list).

## Refresh, freshness and errors

The calendar refreshes every five minutes while visible. A 401 removes previous rows
and offers the service's passkey sign-in; a 503 reports that the source needs setup.
The Open calendar link always opens Google Calendar.

The client requires a valid source snapshot timestamp. The refresh control's tooltip
and accessible description carry the timezone and snapshot time. Snapshots at least
24 hours old, or marked stale by the service, show `Calendar · Stale`, matching the
service's freshness cutoff. An empty stale snapshot says no events are present in that
snapshot, never that the current calendar is clear. A timestamp more than five
minutes in the future fails closed. HTTP reachability does not establish freshness.

## Colors

Color support is additive: `items[].backgroundColor` can contain the resolved Google
event/label color. Alternatively `items[].colorId` resolves against the response's
`colors.event[id].background` palette. The fallback is `items[].calendarColor`, then
response-level `backgroundColor`. Only six-digit hex colors are accepted; missing
colors use the native neutral border. The service resolves label overrides and
calendar defaults; the client never infers colors from titles. See Google's
[event color fields](https://developers.google.com/workspace/calendar/api/v3/reference/events)
and [color palette](https://developers.google.com/workspace/calendar/api/v3/reference/colors).
The live feed does not include colors yet, so colored screenshots are fixture
evidence until the service adds them.

## Worker boundary

The worker validates extension identity and a top-frame T3 sender, uses a fixed
endpoint, follows no redirects, times out after fifteen seconds and bounds response
size. Manifest origin permissions are backed by exact worker endpoints; content
scripts cannot choose URLs or methods.

## Evidence

Fixture tests cover source normalization, DST and exclusive all-day dates, identity,
close/reopen and late responses, hidden refresh, stale/sign-in states and worker
credential separation. Real authenticated evidence requires the packaged worker
receiving a real 200 response and its normalized rows rendering in actual T3. Fixtures, signed-out 401s and a successful source
login are separate evidence.
