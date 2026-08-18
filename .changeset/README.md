# Changesets

This folder is managed by [`@changesets/cli`](https://github.com/changesets/changesets) and
holds the not-yet-released change descriptions for MarketTrader.

## How this repo uses it

MarketTrader is never published to npm — changesets is here purely to produce **one app
version** and a changelog. `server`, `frontend`, and `shared` are a `fixed` group, so they
always carry the same number, and that number is what `GET /api/version` reports.

Versioning and deploying are independent. Deploying does not touch versions, and cutting a
version does not deploy anything.

```bash
pnpm changeset            # describe a change; commit the generated .changeset/*.md
pnpm changeset version    # bump the three packages + write CHANGELOGs, consume changesets
git commit -am "release: vX.Y.Z"
pnpm release:tag          # tag vX.Y.Z
git push --follow-tags    # push before deploying — deployment builds from origin
```

`pnpm changeset publish` is **not** part of the flow; nothing here goes to a registry.

See the "Versioning and Releases" section of `CLAUDE.md` for the full picture, and ADR-014 in
`docs/technical-decisions.md` for why it is set up this way.
