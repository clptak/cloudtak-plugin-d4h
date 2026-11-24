# Vendored code

## overlay-tile.es.min.js

Self-contained browser ESM bundle for Submit Incident overlay Detect (`lib/overlay-tiles.ts`). Copied from cloudtak-plugin-skydio, built from the
versions in CloudTAK's `app/node_modules`, so tiles and style filters behave as they do on the map:

- `VectorTile` from `@mapbox/vector-tile` 3.0.0 (BSD-3-Clause)
- `PbfReader` from `pbf` 5.1.2 (BSD-3-Clause)
- `featureFilter` from `@maplibre/maplibre-gl-style-spec` 26.5.1 (ISC)

CloudTAK has these only as dependencies of `maplibre-gl`, so they are vendored for the same reason
as other plugin dependencies: CloudTAK only runs `npm install` in its own app directory, so a plugin `package.json` dependency is never installed, and the bundle must have no external imports. It starts with `/* eslint-disable */` because CloudTAK lints `./plugins/` with its own config. `overlay-tile.es.min.d.ts` is the minimal type surface the plugin uses.

### Updating

From the plugin root, with `APP` set to CloudTAK's `app` directory:

```bash
cat > /tmp/overlay-tile-entry.mjs <<EOF
export { VectorTile } from '$APP/node_modules/@mapbox/vector-tile/index.js';
export { PbfReader } from '$APP/node_modules/pbf/index.js';
export { featureFilter } from '$APP/node_modules/@maplibre/maplibre-gl-style-spec/dist/feature_filter/index.mjs';
EOF
"$APP/node_modules/.bin/rolldown" /tmp/overlay-tile-entry.mjs --format esm --minify --platform browser --file /tmp/overlay-tile.js
printf '/* eslint-disable */\n' > vendor/overlay-tile.es.min.js
cat /tmp/overlay-tile.js >> vendor/overlay-tile.es.min.js
rm /tmp/overlay-tile-entry.mjs /tmp/overlay-tile.js
```
