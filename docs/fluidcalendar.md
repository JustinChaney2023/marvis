Introduction
Meet FluidCalendar: an open-source alternative to Motion designed to automate time blocking and unify your calendars. If you spend hours every week moving tasks around, juggling multiple calendar apps, or manually trying to match your best work hours to the right tasks—FluidCalendar is built for that problem. It combines an auto-scheduling engine with multi-provider calendar sync, bidirectional task synchronization, and flexible deployment options (self-host or managed SaaS).
This post is an introductory overview: what FluidCalendar does, who benefits most, how the core scheduling approach works at a high level, and the practical ways people are already using it. If you like what you read, you can star the project on GitHub or join the beta waitlist to try the demo.
Core capabilities at a glance
FluidCalendar focuses on features that reduce planning friction and give you a single view of your time.
Intelligent auto-scheduling
Automatically places tasks into available time slots based on your calendar availability, deadlines, task priority, and energy preferences.
Matches high-focus tasks to your peak hours and reserves lower-energy times for admin work.
Respects work hours, buffer times, project grouping, and schedule locks.
Multi-provider calendar sync
Syncs with Google Calendar, Outlook/Microsoft 365, and CalDAV (Nextcloud, Radicale, etc.).
Incremental syncs, webhook support (where available), conflict detection, and multi-account support.
Bidirectional task synchronization
Two-way sync with Google Tasks and Outlook To Do so changes follow you across devices and apps.
Converts recurrence rules, maps external lists to internal projects, and supports selective sync.
Focus mode and project organization
Distraction-free Focus Mode with a timer and quick actions.
Project-based organization, Kanban and list views, recurring tasks with RRule compatibility.
Deployment flexibility
Self-host with Docker and PostgreSQL for full data control, or use the managed SaaS for a low-cost, maintenance-free option.
How FluidCalendar schedules your time (high-level)
At its core FluidCalendar uses a deterministic, configurable scoring approach rather than opaque ML claims. Here’s the simplified flow:
Gather availability: fetch events from your connected calendars and identify free slots within your work hours.
Generate candidate slots: break free time into candidate intervals considering default durations and buffer time.
Score each slot: evaluate candidates using weighted factors such as time until due date, task priority, energy alignment, and preferred time of day.
Example weight breakdown (configurable): Due Date 40%, Priority 25%, Energy Match 20%, Preferred Time 15%.
Pick the best slot that satisfies constraints (duration, buffers, conflicts) and create a scheduled event in your calendar.
Sync and monitor: background jobs handle provider updates, retries, and conflict resolution.
Everything above is configurable — you can change weights, alter energy windows, lock tasks to avoid rescheduling, or exclude specific calendars from availability checks. The goal is automation with manual override, not full autopilot.
Who should try FluidCalendar?
FluidCalendar is aimed at people who need intelligent scheduling plus flexibility and data control.
The overwhelmed knowledge worker: multiple projects, multiple calendars, and too much planning overhead.
The privacy‑minded self-hosting enthusiast: prefers data ownership and wants to customize the algorithm.
The integration power user: relies on both Google and Outlook ecosystems and needs reliable bidirectional sync.
Students and freelancers who want to schedule deep work during peak hours and simple tasks in slumps.
If you already have a polished, team-focused scheduling tool and native mobile needs today, FluidCalendar is still a contender—especially if you value open source or lower cost—but expect beta-level rough edges.
Three short user flows (real examples)
Freelancer: reclaim planning time
Sarah, a freelance designer, connects her personal Google Calendar, her work Outlook calendar, and a shared CalDAV calendar. She tags design work as high energy and admin as low energy. She clicks Schedule All, and FluidCalendar blocks deep design sessions into her morning peaks, reserves afternoons for billing and email, and respects 30-minute buffers. Result: Sunday night planning goes from 90 minutes to a couple of clicks.
Self-hosting engineer: privacy and customization
Marcus runs everything on his own infrastructure. He deploys FluidCalendar with Docker Compose, connects his CalDAV server, and tweaks the scheduler weights to favor morning slots. Because the code is open source (MIT), he can adjust the algorithm, contribute a patch back, and keep full control over his data.
Executive assistant: zero double-bookings
Jessica manages calendars for multiple executives. She links several Google and Outlook accounts, enables color-coded visibility, and uses selective calendar inclusion for availability checks. Auto-scheduling respects everyone’s constraints, dramatically reducing conflicts and reactive scheduling.
Self-host vs Managed SaaS — pick what fits
Self-host benefits:
Full data ownership and control
No license fees (you supply infrastructure)
Ability to modify the algorithm and integrations directly
Managed SaaS benefits:
Minimal setup, automatic updates and backups
Background job processing and daily summaries out of the box
Lower operational overhead, still cheaper than many proprietary alternatives
If you know Docker and PostgreSQL, self-hosting is straightforward; otherwise the SaaS option offers a low-friction path to value.
Six-month content series: what to expect
We’re rolling out a content series to help new users and contributors. Planned cadence (monthly topics):
Month 1: Complete Guide: How to Self-Host (installation, Docker Compose, configuration)
Month 2: Integration Tutorials (Google Calendar, Outlook, CalDAV setup and troubleshooting)
Month 3: Understanding Auto-Scheduling — Algorithm Deep Dive (scoring, weights, tuning)
Month 4: Migration Paths (importing from Motion, Todoist, CSV workflows)
Month 5: Focus Mode and Productivity Workflows (Pomodoro, batch scheduling, project focus)
Month 6: Security, Scaling, and Contributing (deployment best practices, background jobs, how to contribute)
Those posts will include step-by-step guides, code snippets for advanced customization, and practical examples so you can run or extend FluidCalendar with confidence.
How to get started (quick)
Star the repo on GitHub to follow development: https://github.com/dotnetfactory/fluid-calendar
Try the demo or join the beta at the official site: https://fluidcalendar.com
If you’re technical, deploy with Docker Compose and PostgreSQL — the self-host guide will be the first deep post in our series.
Have questions or want to contribute? The best place to start is the GitHub repo issues and pull requests. For support, you can reach the maintainers at hello@elitecoders.co.
Suggested social share copy & image ideas
Share copy examples:
Tweet: “Tired of calendar Tetris? FluidCalendar is an open-source Motion alternative that auto-schedules tasks and syncs multiple calendars. Self-host or try SaaS. ⭐ https://github.com/dotnetfactory/fluid-calendar”
LinkedIn: “If you spend hours planning your week, try FluidCalendar — open-source intelligent scheduling that respects energy levels and works across Google, Outlook, and CalDAV.”
Image ideas (for social and blog headers):
Comparison graphic: FluidCalendar vs Motion (features + price comparison)
Scheduler screenshot: the auto-scheduled week with color-coded calendars
30-second demo clip: show Schedule All → tasks placed into morning deep-work blocks
(We won’t include media in this post, but these are suggestions for promotional assets.)