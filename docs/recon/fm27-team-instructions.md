# FM27: team instructions (started)

Read on the Windows Steam build 26577676, on the Persija save of 15 March 2028, with `fmlibre-probe scout --tactics`
(which now prints the block of the tactic in use) and a byte diff of the block before and after one change in the
game's tactics screen (left before reading: the game writes a new block when the screen is left).

The tactic in use was a "Clean Slate" one (style tag `NULL` at `+0x100`): its eleven 16-byte records at `+0x000` are
all zero.

## The instruction bits

The ten bytes at **`+0xE0`** are a bit set, read little-endian (bit n is bit n%8 of byte n/8): each choice of an
instruction other than its default has a bit of its own, and the default (Standard, Balanced) sets none.

| Instruction | Choice | Bit |
| --- | --- | --- |
| Tempo | Much Higher | 46 |
| Tempo | Higher | 47 |
| Tempo | Standard | (none) |
| Tempo | Lower | 48 |
| Tempo | Much Lower | 49 |

Bits set with the manager's own instructions (in possession: More Direct, Much Higher tempo, Much Narrower, Counter-
Attack, More Expressive, Time Wasting Less Often, Keep Ball in Play, Work Ball Into Box, Discourage shots, Low
Crosses, Encourage dribbling, Pass Into Space, Play Through Press, Short goal kicks, to Centre-Backs; out of
possession not recorded): `a4 30 0b 00 08 50 60 28 62 01`, 19 bits.

`+0x106` and `+0x107` went 0 → 1 → 0 as tempo went Much Higher → Higher → Standard: not understood.

Bytes past `+0x150` change from one block to the next whatever the change (left-over memory), so only the head was
compared.

## Next

A ready-made style sets many instructions at once and the tactics screen's Overview lists them: a few styles, each
with a screenshot of the Overview, would place most bits in a few rounds. Mentality was not looked for yet (perhaps
near the style tag, `+0x104` read `02 04`).
