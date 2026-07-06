# UI_change.md — 柔和生活風 Main Screen Redesign

> Plan written before code changes, per task instructions. UI/layout only — no
> recording / SenseVoice WS v2 / Smart Cleanup / stop-finalize logic touched.

## 1. Scope

Redesign `frontend/src/App.tsx` main screen markup + styling (warm off-white,
green accent, rounded cards) and move mode/language selectors from the
settings drawer onto the main screen. All existing state, refs, and handler
functions are reused as-is. New additive state is limited to: recording timer
display, and a history-button placeholder toggle.

## 2. Untouched (verified by reading current source first)

- `cleanupAudioPipeline`, `primeMicPermission`, `requestMicStream`
- `startMockRecording` / `stopMockRecording` / `simulateMockCleanup`
- `callCleanupAPI` / `callSmartCleanupAPI` / `runCleanupForCurrentMode`
- `startRealRecording` / `stopRealRecording` (SenseVoice + Gemini Live branches,
  stop → flush → END → wait end_ack → disconnect handshake)
- `handleMicPress` (tap-to-toggle), `handleCopy`, `handleReset`
- `LiveClient`, `SenseVoiceWsClient`, `audio/converter.ts` — not opened for edit
- Backend routes/contracts — not touched

## 3. New additive state (small, isolated)

- `elapsedSeconds` + interval effect keyed on `isRecording`, plus `formatTimer()`
  → drives the "00:28" recording timer in the transcript card header. Resets
  on each new recording, clears on stop/unmount.
- `showHistoryPlaceholder` boolean → controls a small dismissible modal saying
  "歷史紀錄即將推出" when the new 歷史紀錄 button is tapped. No storage, no
  history feature logic.
- `MODE_LABELS` / `LANGUAGE_LABELS` — pure display-label lookup maps for the
  front-page selector rows (native `<select>` + `<option>` values/logic
  unchanged).

## 4. Reality check vs. the mockup brief

- Current bottom control area already has **only one button** (the
  tap-to-toggle mic). There is no left "停止" square button and no
  right tick/complete button to remove — so "remove stop button / replace
  tick button" reduces to: add the new 歷史紀錄 button next to the existing
  mic button. Nothing to delete here.
- `App.css` is unused leftover Vite template CSS (not imported anywhere;
  `main.tsx` only imports `index.css`). Left untouched — not part of this
  change and not dead code *I* introduced.

## 5. Two explicit spec requirements that intentionally change existing default
   behavior (and how tests are kept green)

**(a) Smart Cleanup becomes the default `mode`.**
Spec: "smart cleanup should be the default mode." Today `useState<Mode>('message')`.
Several existing tests never explicitly select a mode and rely on the *old*
default to hit `/api/cleanup` (not `/api/smart-cleanup`), and the
`selectSemanticMode()` test helper locates the mode `<select>` via
`getByDisplayValue(/訊息聊天/i)` (today's default option). Changing the default
is explicitly requested, so instead of leaving it unchanged to dodge test
breakage, I'm updating the affected tests' *setup* (not their assertions) to
explicitly select the mode they need — this keeps each test's original
intent (verifying the 4-mode `/api/cleanup` path vs. the `/api/smart-cleanup`
path) fully intact. Also adding `aria-label="整理模式"` / `aria-label="語言模式"`
to the two selects so tests can locate them by role+name regardless of
current value (more robust than `getByDisplayValue`).

**(b) Mode/language selectors move out of the settings drawer onto the main
screen (always visible).**
One existing test ("toggles settings menu…") asserts `整理模式` text is absent
until settings is opened — that assumption is exactly what's being changed.
Updating that test to assert on a settings-only string ("沙盒/模擬模式") instead,
preserving its real intent: verifying the settings panel open/close toggle
still works. Settings panel keeps exactly mock-mode + haptics toggles, nothing
else.

Both changes are mechanical adaptations to explicitly-requested new behavior,
not weakened assertions. Will run the real test suite after implementation and
fix anything unanticipated rather than hand-waving it.

## 6. Cosmetic-only, low-risk extras

- Swap header settings icon `Sliders` → `Settings` (gear) to literally match
  "settings gear button"; aria-label stays `設定` (tests query by that).
- Rename the `semantic` mode `<option>` label from "語義整理" → "智能整理" so the
  native picker and the new front-page pill agree with the approved copy
  ("整理模式 … 智能整理"). Value (`semantic`) and all logic unchanged.
- Debug telemetry row (`debug v01:35: ws=… setup=… …`) gated behind
  `import.meta.env.DEV` (Vite's built-in flag — `true` in `vite dev` and in
  Vitest, `false` in `vite build`). This satisfies "hide debug text in normal
  UI" for production while keeping the existing debug-row assertion
  (`end=1 ack=1`) passing under Vitest, since `import.meta.env.DEV === true`
  there (verified empirically).
- PWA manifest `theme_color`/`background_color` in `vite.config.ts` updated
  from dark (`#1a1a1a`) to the new warm background, so the iOS install splash
  doesn't clash with the new light UI.
- Outer app shell switches from fixed `h-screen overflow-hidden` to
  `min-h-screen` natural document flow, per "single vertical flow" +
  "responsive... narrow iPhone screens" — more content (selectors now always
  visible + timer) needs to be allowed to flow/scroll on small screens instead
  of being clipped in a fixed viewport box.

## 7. Explicitly skipped/deferred (flagging, not silently dropping)

- "Interim transcript can be lighter grey if needed" — skipped. Verified via a
  throwaway RTL probe that Testing Library's `getByText` only concatenates
  *direct text-node children* of one element; the existing test
  `shows finalized and interim SenseVoice transcript together` asserts the
  merged string `第一句。第二句未完` as one `getByText` match, which only works
  because today's code renders `{finalTranscript}{interimTranscript}` as one
  concatenated string in a single `<p>`. Splitting interim into a separately
  colored `<span>` breaks that existing test contract. "Keep existing
  behavior" (hard requirement) wins over "grey interim if needed" (soft,
  explicitly conditional).
- Smart Cleanup card's existing 清除 (Trash2/reset) button isn't in the spec's
  literal 3-part layout (icon+title header / bold text body / small copy
  button lower-right). Not removing existing functionality — placing it next
  to the copy button as a second small icon in the lower-right cluster
  instead of dropping it.

## 8. Visual tokens (added to `index.css :root`, referenced via Tailwind
   arbitrary `var()` values to match the existing utility-class convention —
   no CSS-in-JS/styled-components introduced)

```
--color-bg: #FFF9EF
--color-card: #FFFFFF
--color-primary: #4CAF67
--color-text: #1F2A24
--color-text-muted: #6F7A72
--color-pill-green: #EAF6EC
--color-pill-yellow: #FFF2C7
--color-border: rgba(60, 80, 60, 0.08)
```
Soft shadow via Tailwind arbitrary value, e.g. `shadow-[0_4px_16px_rgba(60,80,60,0.08)]`.

## 9. Icons (lucide-react, already a dependency — all verified present in
   `node_modules/lucide-react`)

`Mic`, `Copy`, `Check`, `ChevronDown`, `Sparkles` (kept); add `Settings`
(gear), `Sprout` (app mark), `Tag` (整理模式 row), `Globe` (語言模式 row),
`History` (歷史紀錄 button), `AudioLines` (small wave icon in transcript
header); `Trash2` kept for the relocated clear button.

## 10. File-by-file change list

- `frontend/src/App.tsx` — header, always-visible selector rows, transcript
  card, cleanup card, bottom controls (mic + 歷史紀錄), history placeholder
  modal, new additive state, default `mode` → `'semantic'`, `semantic` option
  label text.
- `frontend/src/index.css` — flip `:root`/`body` to warm/light, add CSS
  custom properties.
- `frontend/vite.config.ts` — PWA manifest theme/background color values only.
- `frontend/src/test/app.test.tsx` — `selectSemanticMode` helper locator,
  explicit mode selection added to the handful of tests that relied on the
  old default, settings-toggle test assertion target updated, two new small
  tests added for the new default-mode and history-placeholder behavior.
- `UI_change.md` (this file), `STATUS.md`, `CHANGELOG.md`.

## 11. Verification plan

1. `npx vitest run` (focused + full frontend suite) — fix any red until green,
   report exact pass/fail counts (not claimed blindly).
2. `npm run typecheck` (`tsc -b --noEmit` via tsc project refs).
3. `npm run build`.
4. Manual review against the 15 functional acceptance criteria in the task.
5. No `iPhone Safari` real-device pass in this session (no device available) —
   will flag this honestly rather than claim it.
