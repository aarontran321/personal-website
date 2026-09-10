# model-src

Pristine, uncompressed source assets. Not shipped.

`chibi_yasuo.source.glb` is the raw export. The build-time asset that the site
actually loads, `components/chibi_yasuo.glb`, is derived from it by:

```
npm run optimize:model
```

See `scripts/optimize-model.mjs` for what that does and why. Re-run it after
replacing the source file; never edit `components/chibi_yasuo.glb` by hand.
