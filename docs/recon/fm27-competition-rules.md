# FM27: competition rules (not found yet)

Looked for on the Windows Steam build 26577676 (14 November 2026), on a test career made with an editor data file
whose Indonesian Super League registration rules read: at most 13 foreign players, squad of 18 to 35, at least 3
goalkeepers, domestic players aged 20 or younger need no registration (the game's own: 11 and 33).

## What the editor's Pre-Game Editor shows

FM27 keeps match rules per nation, numbered: Advanced Rules → Show Rules For (a nation) → Match Rules → Rules 0
League One, Rules 1 League Two, ... A competition picks its set through "Match Day Rule"; custom reserve competitions
(type "Custom xml", teams U21s) default to the nation's "Custom U21" set.

## What was found in memory

- Competitions: `db::COMP` objects (8,248) with the full name at +0x40, the short name at +0x48, the nation at +0x60
  and the game's object (`sicomps::ACTUAL_COMP`) at +0xB0; the probe's `comps <text>` lists them. The Super League's
  UID is 41004312 (internal id 3295, at +0x08).
- `GAME_RULE_GROUP_MANAGER`: one object, with lists of 69 and 90 entries at +0x50 and +0x68; not decoded.
- No 8-, 16- or 32-bit layout holding 13, 35, 18 and 3 (and 20) together, near the competition's objects or
  anywhere, turned out to be the rules: every hit was a table of statistics or image data.

## Next

The screen's numbers are likely put together from rule entries (a kind and a value) of the nation's rule sets, not
stored as one record. A second test career from the same file with one number changed (13 → 14) would allow a
diff of the rule manager's lists between the two.
