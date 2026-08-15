---
'@markettrader/server': patch
---

Upgrade `yahoo-finance2` to v4. v3 is no longer supported upstream; v4's only
breaking change is requiring Node 22+, which this project already exceeds. The
provider's call surface is unchanged.
