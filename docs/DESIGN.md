# WakeUp v3 design system (Phase 12)

Status: **direction locked 2026-11-19: D · Glass + Paper, with the Cards version of Today** (Kim). The reference is `docs/design/v3-drafts.html`, draft D.

- **Glass, from A, only for what floats:**
  - **Tab bar:** a floating pill (blur 22, saturate 1.7) with the two-edge liquid highlight.
  - **Sheets and toasts:** the Settings sheet and the toasts are glass.
- **Paper, from B, for the page:**
  - **Page:** a white page (`#ffffff` light, `#000000` dark). Flat lists with hairlines, not a card around every section.
  - **Now:** set in big type with no box.
  - **Cards:** outlined exam cards and app tiles. Surface boxes (`#f3f4f6`) only for inputs and the focus card.
- **Type and shape:** Inter, titles at weight 750, `--r-card` 18, `--r-input` 12.
- **Today (Cards):**
  - Now (with "Then …" and Join)
  - Due today
  - Coming up (exam countdowns)
  - Today's classes
  - Your apps

  The day-as-a-timeline view lives in Timetable → Day.

The drafts' A, B and C directions are history: `docs/design/v3-drafts.html` keeps them for reference.

## Principles
1. **The day first.** Every screen answers "what's now, what's next, what's due" before anything else.
2. **One accent, spent on action.** WakeUp blue `#2b63d9` (or the user's chosen accent) marks the primary action, the active tab and progress. Nothing else is blue.
3. **Class colours carry meaning, not decoration.** A class's colour appears only where that class is: its capsule, chip, dot or widget row.
4. **No gradients, no emoji in chrome, no glass on content.** Glass is a *material* for things that float over content (the tab bar, sheets, toasts). Cards are opaque.
5. **Motion has a job** (feedback, continuity, state change). If it has none, it doesn't move.
6. **Same app, three sizes.** Phone (bottom bar), tablet (sidebar), desktop (sidebar plus app panes) share tokens, components and words.

## Shape
- **One radius scale, continuous corners everywhere.** Use `borderCurve: 'continuous'` in React Native and `corner-shape: squircle` in CSS where supported.
  - Actions and chips: pill (999).
  - Cards and sheets: 18 (`R.card`).
  - Rows inside groups: 0 (the group clips).
  - Inputs: 12 (`R.input`).
  - Small chips: 8 (`R.chip`).
  - Icon tiles: 30% of size.
- **The tab highlight is the same shape on every tab** (fixes the audit's M5).

## Type
| Role | Size / line | Weight | Use |
|---|---|---|---|
| Large title | 34 / 40 | 700 | one per screen, collapses on scroll |
| Title | 22 / 28 | 650 | card titles, the Now card |
| Headline | 17 / 22 | 600 | row titles |
| Body | 16 / 22 | 400 | everything else |
| Footnote | 13 / 18 | 500 | metadata, chips |
| Caption | 11 / 14 | 600, +0.04em, caps | section labels |

Times, countdowns and counts use tabular numerals. The family is **Inter** (400/500/600/700/800), bundled on Android by the `expo-font` plugin in `mobile/app.json`; the desktop uses the same files.

## Spacing
A 4-pt base: 4, 8, 12, 16, 20, 24, 32, 40. Screen gutters are 20 on phones, 24 on tablets and 32 on desktop. Use `gap`, never stacked margins.

## Colour tokens (both themes, day one)
Neutrals are a single cool-grey family. Semantic colours are separate from the accent:
- good `#1f9d63`
- warn `#c27a12`
- bad `#d0453a`

Class palette (unchanged, so synced data keeps its colours): `#2f6fde #7c5cd6 #1f9d63 #d0573a #c2410c #0f8a8a #b4417a #b7791f`.

## Motion vocabulary
| Name | Spring / timing | Used for |
|---|---|---|
| `settle` | spring, damping ratio 1.0, ~400 ms | things coming to rest |
| `sheet` | spring, damping ratio 0.8, ~300 ms | sheets, focus overlay, push pages |
| `liquid` | two springs: leading edge stiff (520), trailing edge soft (260), ratio 0.72 | the tab highlight. It stretches toward the new tab and settles with a small jiggle |
| `press` | 120 ms ease-out, scale 0.97 | buttons and cards on press-in. List rows get a highlight, not a scale |
| `fade` | 150 ms in, 90 ms out, ease-out `(0.23,1,0.32,1)` | tab content (tabs never slide) |
| `rubber` | resistance 0.55, spring back with `settle` | overscroll at the top and bottom of every scroll view, sheets dragged past their stop, task rows past the swipe limit |

Rules:
- If a finger drove it, it's a spring that starts from the live value and takes the release velocity.
- Exits are faster than entrances.
- Reduce Motion turns spatial motion into cross-fades.
- Nothing moves while the user is reading.

## Haptics map (Android `expo-haptics`)
- **Selection tick:** tab change, segmented control, day picker.
- **Light impact:** a task snaps done, a swipe passes its threshold, a sheet snaps home.
- **Success:** a focus session completes.
- **Warning:** delete. Undo is always offered.

## Components
- **Tab bar:** Today, Timetable, Tasks, Apps. Settings is the avatar button at the top right of Today (and at the bottom of the tablet and desktop sidebar).
- **Now card:**
  - **Now / next:** happening now with a progress bar and "ends in", or the next class with a countdown.
  - **Details:** venue, or Online with Join.
  - **Exam:** a chip when one is coming up.
- **Timeline (Today variant 1):**
  - **Line:** hour rail, with class capsules sized by duration.
  - **Free gaps:** labelled "Free 11:00–12:00", and they suggest due tasks that fit.
- **Cards (Today variant 2):** Now, Due today, Exams, Today's classes, Your apps.
- **Quick add:**
  - **Input:** one line that understands "lab report fri CSP1123" and shows what it understood as chips before you add.
  - **Voice:** the mic uses Android speech-to-text.
- **Task row:**
  - **Finish:** tap the circle, or swipe right.
  - **Delete:** swipe left.
  - **Rubber band:** a row dragged past its limit resists, then springs back.
  - **Undo:** offered for both.
- **Toast:**
  - **Look:** a pill that drops from the top.
  - **Contents:** an icon, one line, and an optional action (Undo, Open).
  - **Timing:** it stays 4 s, or until you swipe it up.
  - **Progress:** shown in the same pill (update download, sync).
- **Sheet:** drag to dismiss, grouped lists inside, sub-pages push sideways inside the sheet.
- **Class page (hub):**
  - **Meeting:** the next meeting, with Join.
  - **Work:** its tasks, exams and notes.
  - **Links:** its Ebwise course, and "Focus on this class".
- **Focus:**
  - **Opening:** a full-screen overlay that grows from the Focus button.
  - **Timer:** a ring, with 25/5, 50/10 and custom modes.
  - **Controls:** Pause and Stop.
  - **Do Not Disturb:** a switch.
  - **Stats:** sessions this week, by class.

## Notifications
- **Small icon:** a white "W" on a **transparent** background, 24 dp, nothing else. It replaces `android-icon-monochrome.png` for notifications (audit H2). The tint is the accent.
- **Channels:** Classes, Tasks, Focus, Updates.
- **Actions:**
  - class reminder: Join (when online), Snooze 5 min
  - task due: Done, Tomorrow
  - focus: Pause, Stop (ongoing while focusing)
  - update: Install
- **Grouping:** one summary per channel when there are 3 or more.

## Widgets (Android)
- **Small 2×2, Next class:** code, time, venue or Join, and a countdown.
- **Medium 4×2, Due today:** up to 4 tasks, each with a done circle.
- **Large 4×4, Today:** a mini timeline with classes, free gaps and tasks.
- Each widget follows the system's light/dark mode, uses the same radius as cards, and has no glass (widgets sit on wallpaper).

## Icons
One family: **Lucide** (ISC licence), stroke 1.75, 20/24 px. It replaces the hand-drawn paths in `src/ui/common.js` and `mobile/src/ui/Icon.tsx`. App logos stay as real logos.
