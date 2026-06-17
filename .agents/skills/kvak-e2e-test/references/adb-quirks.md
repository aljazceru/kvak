# adb UI driving — gotchas that cost hours

These bit the testing run repeatedly. Read before driving any RN/Android UI over adb.

## `adb shell input text` has a ~36-char ceiling (Pixel 9a / Android 16)

Strings longer than ~36 chars **silently fail** — they either type nothing or,
worse, dismiss the foreground modal/screen. Verified ceiling: 36 chars ok, 70
chars fails. There is no error; the field just stays empty.

**Implications:**
- For chat messages, keep prompts short (≤36 chars). `%s` → space.
- For RAG document ingestion, ingest **short single-string facts** (≤36 chars),
  e.g. `The%svault%scode%sis%sZebra4488`. Run-on text with no spaces is
  unparseable by small models even if it lands.
- Appending via repeated `input text` calls also tends to dismiss the field on
  this device — don't rely on chunked appends.

## adb cannot pass literal spaces

`adb shell input text "a b"` → types only `a` (space is the arg separator).
Use `%s` and replace, or `_`. The `adb-ui send` subcommand maps `%s → space`.

## Other apps steal focus during input delays

Long typing + modal transitions let **other apps grab foreground** — typed
text then lands in them (a browser's search box, Termux). During the run,
text vanished into a GitHub search field mid-test.

**Defenses:**
- `adb shell am force-stop app.vanadium.browser` (+ any known interferer).
- Before each interaction, refocus:
  `adb shell am start -n com.kvak/.MainActivity`.
- If a dump shows text you didn't type, suspect focus theft.

## The keyboard shifts the layout

Tapping an input shows the soft keyboard; everything below it (incl. the send
button) moves up. A send button found at y=2114 pre-focus jumps to y≈1276
post-focus.

**Defense:** re-dump right before tapping. `adb-ui tap LABEL` re-dumps on every
call, so just call it — don't reuse stale coords from an earlier dump.

## Emoji buttons can't be tapped by ASCII substring

The gear `⚙️`, send `↑`, new-chat `＋` expose no ASCII substring. Options:
1. Tap by **coords** copied from `adb-ui dump` (the dump prints the label +
   its x/y even for emoji).
2. Match `content-desc` if set (`adb-ui find` checks both).

## Verifying field contents

`uiautomator dump` puts committed EditText text in the `text=` attribute —
this is the reliable way to confirm what's in a field (don't trust the
keyboard). `adb-ui dump` surfaces these.

## XML quirks in matching

- `&` is encoded as `&amp;`: a button "Add & Embed" matches substring `Embed`.
- `+` in `+ Paste Text` is a literal; `＋` (full-width) is different — match
  on the ASCII part (`Paste Text`).

## Tap-by-text when the same label repeats

`adb-ui tap` hits the **first** match. For the nth (e.g. the 2nd "Download"
button in a model list), either scroll to isolate it or tap by coords from
`dump`.
