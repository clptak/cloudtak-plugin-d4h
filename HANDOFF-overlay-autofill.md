# Handoff: D4H overlay auto-fill

Written 2026-11-05 after fixing the related problem in `~/dev/cloudtak-plugin-skydio`. **Nothing in this repo has been changed yet.** Everything below comes from reading the code and git history. None of it has been run on a live map.

This file is uncommitted. The repo is public, so do not commit deployment values, and delete this file when the work is done.

## Summary

The owner thinks D4H has the same issue as Skydio: overlay auto-fill depends on deployment-specific values that belong in config, not in code. D4H has that problem, but its symptoms and details differ, so do not copy the Skydio fix wholesale.

| | Skydio (fixed) | D4H (this repo) |
|---|---|---|
| Deployment rows | Hardcoded in the tracked file | Removed from the tracked file, so the table is empty |
| Symptom | Red error on Detect | No error. The Detect button is simply hidden |
| Overlay names | Placeholder `TODO:` names blocked Detect | Not used |
| Turns overlays on automatically | Yes | No. It reads only overlays that are already on |
| Calls `initOverlays()` | Yes, which re-ran map setup | No |
| Reads `store.overlays` (no longer on the map store) | Yes, which broke Detect | Yes, but only for debug output |
| Layer id matching bug | Fixed | Present, in a different form (see issue 2) |

## Issues

### 1. Auto-fill is off because the rows were removed

Commit `89eecb0` ("Sanitize repo for public release", 2026-07-09) emptied `OVERLAY_FIELD_MAP` in `lib/overlay-field-map.ts`. That was deliberate, but nothing replaced it.

The effect, in `components/SubmitIncidentView.vue`:

- `hasOverlayMapping` (line 436) is false, which hides the Detect button (line 67).
- Auto-detect on point selection (line 740) never fires.
- The hint on line 79 tells people to edit `lib/overlay-field-map.ts`, and those edits would then conflict with updates.

To see the old rows, run this locally:

```bash
git show 89eecb0^:lib/overlay-field-map.ts
```

Some of those rows have `customFieldId` comments that say `TODO: replace with the real D4H ... field id`. Confirm the ids with the owner instead of assuming they are correct.

**Fix:** load the rows from the gitignored `config.local.ts` at build time. The repo already has this pattern in `lib/deploymentDefaults.ts` and `config.local.example.ts`, and `config.local.ts` is already in `.gitignore`. No local `config.local.ts` exists yet.

1. Add a loader to `lib/deploymentDefaults.ts`, and add `overlayFieldMap?: OverlayFieldMapping[]` to `DeploymentModule`. It must call `import.meta.glob('../config.local.ts', { eager: true })` directly, because Vite only compiles the literal call.
2. Use `import type` for `OverlayFieldMapping` in that file, so there is no runtime import cycle with `overlay-field-map.ts`.
3. Set `OVERLAY_FIELD_MAP = deploymentOverlayFieldMap()` and keep only types and helpers in `lib/overlay-field-map.ts`.
4. Add a generic, commented example of `overlayFieldMap` to `config.local.example.ts`. **Use placeholder values only.** Skydio's example contains real rows, but this repo was deliberately sanitized.
5. Update the header comments and the hint on line 79 to point to `config.local.ts`, and update `README.md` or `docs/` if they describe this.

### 2. Layer ids that start with a number probably never match

`detectValues` in `lib/overlay-detect.ts` (lines 148-157) keys rendered features by `layerSuffix(f.layer.id)`, then looks up `layerSuffix(m.overlayLayerId)`. That strips the leading number from **both** sides:

- A row's `38-polyline1` is stripped to `polyline1`.
- The runtime layer `1202-38-polyline1` is stripped to `38-polyline1`.
- These do not match, so the row silently returns no value.

If a runtime layer is literally `38-polyline1`, the opposite happens: it becomes `polyline1` and can match an unrelated overlay's `<id>-polyline1` layer.

This may explain why a June commit changed a row from `136-poly` to `ranger-poly`, but that is a guess. Several of the old rows start with a number, so check them against **Inspect overlays at point**.

**Fix:** compare the runtime suffix with the configured id as written, and do not strip the configured id. Skydio's version is `layerMatches` in its `lib/overlay-detect.ts`:

```ts
return runtimeLayerId === configLayerId || layerSuffix(runtimeLayerId) === configLayerId;
```

Full runtime ids in rows then stop working, which is correct because they change on restart. Update the comments that say they work (`overlay-field-map.ts` line 32, `overlay-detect.ts` line 155).

### 3. Debug output reads an overlay list that no longer exists

`overlaysFromStore()` (`SubmitIncidentView.vue` lines 662-666) casts the map store through `unknown` and reads `.overlays`. In CloudTAK 13.119 loaded overlays live in `OverlayManager.loaded` (`app/src/base/overlay.ts`), and the map store has no `overlays` list. So the debug panel will always report no visible overlays, even when some are on. The cast is why the typecheck does not flag this.

Inspect and Detect themselves use `queryRenderedFeatures`, so this issue alone does not break them.

**Fix:** remove the cast and pass `OverlayManager.loaded` directly:

```ts
import OverlayManager from '../../../src/base/overlay.ts';
```

Check the relative path from this repo's `components/` directory, and confirm the import resolves to the same module the app uses. Skydio's check: on the dev server, the transformed plugin file and `/src/stores/map.ts` both import the same `/src/base/overlay.ts` URL. Update the comments claiming the list can be empty inside a plugin (`overlay-detect.ts` line 88, `SubmitIncidentView.vue` line 663).

## Decision for the owner: should D4H turn overlays on automatically?

D4H only reads overlays that are already on, so a field stays blank if its overlay is off. Skydio now finds each overlay from its layer ids, turns it on, reads the value, then turns it back off. That could be ported, but **ask first**:

- D4H auto-detects every time a point is picked, not only on a button click.
- `overlay.update({ visible })` saves to the server, so each pick could send several profile updates for each overlay.

## Do not

- Do not call `useMapStore().initOverlays()`. It is CloudTAK's map setup, and it registers map event handlers and creates overlays again.
- Do not use `getOverlayByName`. It is not in CloudTAK's `app/src` at 13.119.
- Do not reach CloudTAK internals through `as unknown as`. It hides the kind of API change that caused this.
- Do not put the D4H personal access token in `config.local.ts`. The file is compiled into the web bundle.
- Do not put real rows in tracked files.

## Flag to the owner: old rows are still public

The repo is public, and `89eecb0` only removed the rows from the current files. They are still readable in git history on GitHub. They contain D4H custom field ids and overlay value mappings. Do not rewrite history without an explicit decision from the owner, since it is destructive and affects anyone with a clone.

## Verifying

The plugin is symlinked at `~/CloudTAK/app/plugins/d4h`. Run these from `~/CloudTAK/app`:

```bash
npx eslint --config eslint.config.js ./plugins/d4h/
```

```bash
npm run check
```

`npm run check` already reports 7 errors in `plugins/livewx-radar/server/plugin-livewx.ts`, which are unrelated.

Then test:

1. Load the config rows through Vite and compare them with the old table. Skydio used a throwaway plugin copy and `ssrLoadModule`, so no real `config.local.ts` gets created in the repo.
2. Test the matching with fake features: `1202-38-polyline1` must match a row's `38-polyline1`, and `77-polyline1` must not.
3. With no `config.local.ts`, the plugin must still build and the Detect button stays hidden.
4. On a live map, with the owner signed in: turn the overlays on, pick a point, and confirm the D4H fields fill in. The previous agent stopped at the dev server login and could not test this step.

Restart `npm run serve` after changing `config.local.ts`, because Vite reads it at build time.

## Reference: the Skydio fix

In `~/dev/cloudtak-plugin-skydio`, branch `feature/pre-flight-tab`:

- `4fcf64d` moved the rows to `config.local.ts`.
- `5f5ce88` moved the lookup to `OverlayManager`, matched by layer id, and fixed `layerMatches`. It was not yet pushed when this was written.

The Skydio fix has not been tested on a live map either, so check with the owner before treating it as proven.

Useful files there: `lib/overlay-ensure.ts`, `lib/overlay-detect.ts`, `storage/deploymentDefaults.ts`, `config.local.example.ts`, and `docs/config-local.md`, which explains the config pattern in full.
