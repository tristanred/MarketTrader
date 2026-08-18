---
'@markettrader/frontend': patch
---

Make the first quick-fill press in the trade dialog set the share count rather
than add to it, so `+25` on a fresh dialog gives 25 instead of 26.

The Shares field defaults to 1 and the quick-fill buttons were unconditionally
additive, so the placeholder default was silently folded into every order sized
that way. The quantity state now carries a `null` "not sized yet" sentinel — the
field still shows 1, but the first `+N` press jumps straight to N. Once the order
has been sized by any means (a quick-fill press, typing, the slider, Max or a %
button) the buttons go back to adding, so `+25` twice is still 50. Reopening the
dialog, picking a different symbol, or hitting Clear restores the behaviour.

Clamping is unchanged: a first press still cannot exceed the buying-power or
shares-held maximum.
