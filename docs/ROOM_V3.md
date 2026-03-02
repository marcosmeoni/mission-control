# Task Room V3 — Group-Chat Style UX

## Overview

Room V3 transforms the Task Room from a simple message list into a **group-chat style timeline** among agents and humans. Messages are presented as bubbles with clear agent identity, timestamps, event badges, and filter chips.

## Features

### Per-Agent Bubbles
- Each message sender gets an avatar emoji + name header
- Consecutive messages from the same sender are grouped (only one header shown)
- Human messages align right; agent messages align left
- Color-coded bubble styles per event type

### Bubble Color Coding
| Event Type | Style |
|---|---|
| Tool execution (`🔧`) | Yellow left border, dark bg |
| Dispatch/Handoff (`🚀 🤝 🎯`) | Green left border, dark green bg |
| Agent output (`🔄`) | Blue left border, dark blue bg |
| Human message | Accent blue filled, right-aligned |
| Generic agent | Dark card with border |

### Event Badges
Displayed inline inside each bubble:
- `🔧 Tool` — tool execution summaries from room-mirror-v2
- `🔄 Output` — mirrored agent text
- `📋 Status` — task status changes
- `🚀 Dispatch` — task dispatch events
- `🤝 Handoff` — single-specialist routing
- `🎯 Multi-spec` — multi-specialist fan-out events

### Filter Chips

Located at the top of the Room panel:

| Chip | Shows |
|---|---|
| **Todo** | All messages |
| **🔄 Decisiones** | Human messages + agent text output |
| **🔧 Herramientas** | Tool execution summaries |
| **📋 Estado** | Task status changes and dispatch events |

Counts per category are shown in parentheses.

### @Mention Helper
- Click **@mencionar** button to show/hide the agent picker
- Typing `@` at the end of the input auto-shows the helper
- Clicking an agent inserts `@AgentName ` into the compose box

### Quick Commands
- `/status` — asks for a quick status update
- `/block` — asks what's blocking progress
- `/handoff` — requests a structured handoff summary

### Typing Indicator
When `room-mirror-v2` detects an agent is actively running tools, a **pulsing typing indicator** appears at the bottom of the message list with animated dots.

### Mobile-First (≤640px)
- Full-width compose area (stacked layout on mobile)
- Bubbles cap at 90% width on mobile, 75% on desktop
- Scrollable timeline with `max-h-[55vh]` on mobile / `60vh` on desktop
- Agent selector above the input on mobile

## Implementation

**Component:** `src/components/TaskRoom.tsx`

Key functions:
- `groupMessages()` — groups consecutive same-sender messages
- `getMessageCategory()` — classifies each message for filter chips
- `getBubbleStyle()` — returns Tailwind classes for bubble color
- `getBadge()` — returns badge metadata for a message

## Migration from V2

Room V3 is a full drop-in replacement for the previous `TaskRoom.tsx`. No API or database changes required. Existing room messages display correctly.
