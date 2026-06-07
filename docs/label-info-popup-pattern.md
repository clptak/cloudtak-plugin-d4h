# CloudTAK plugin pattern: form label + info popup

Reusable pattern for a **config form field label** with an inline **info icon** that opens a small help popup. Click outside the popup to close it — **no close (“×”) button**.

Reference implementation: `components/ConfigView.vue` (D4H Personal Access Token field).

---

## When to use

- A settings/config field needs a short external link (docs, vendor instructions, OAuth setup guide).
- You want help available without cluttering the form or using a dismissible alert.
- The popup should feel lightweight: toggle on icon click, dismiss on outside click.

Do **not** use Bootstrap’s built-in popover/dropdown if you need “no ×, click outside only” — this pattern is simpler and matches CloudTAK plugin markup (Tabler + Bootstrap utilities).

---

## Dependencies

| Package | Source at runtime |
|---------|-------------------|
| `@tabler/icons-vue` | CloudTAK `api/web` host (`IconInfoCircle`) |
| Vue 3 | Host |

Plugins compile into the host bundle. Import icons from `@tabler/icons-vue`; do **not** add plugin-local `node_modules` for this in Docker builds.

---

## UI structure

```
[Label text]  (i)     ← icon button toggles popup
              ┌─────────────────────────────────────┐
              │ Link text → external docs           │
              └─────────────────────────────────────┘
[input field]
```

Layout rules:

- Wrap label + icon in `d-flex align-items-center gap-1 mb-1`.
- Set `mb-0` on the `<label>` so spacing comes from the wrapper.
- Icon sits in `position-relative` container; popup is `position-absolute` below the icon.

---

## Template (copy and adapt)

Replace `FIELD_LABEL`, `ARIA_LABEL`, `HELP_LINK`, `LINK_TEXT`, and ref/handler names.

```vue
<div class='mt-2'>
    <div class='d-flex align-items-center gap-1 mb-1'>
        <label class='form-label small fw-semibold mb-0'>FIELD_LABEL</label>
        <div
            ref='fieldHelpRef'
            class='position-relative d-inline-flex'
        >
            <button
                type='button'
                class='btn btn-link btn-sm p-0 text-muted lh-1 border-0'
                :aria-label='ARIA_LABEL'
                @click.stop='fieldHelpOpen = !fieldHelpOpen'
            >
                <IconInfoCircle
                    :size='16'
                    stroke='1.5'
                />
            </button>
            <div
                v-if='fieldHelpOpen'
                class='position-absolute start-0 mt-1 p-2 bg-body border rounded shadow-sm small'
                style='z-index:1050; min-width:16rem; top:100%;'
                @click.stop
            >
                <a
                    :href='HELP_LINK'
                    target='_blank'
                    rel='noopener noreferrer'
                >
                    LINK_TEXT
                </a>
            </div>
        </div>
    </div>
    <!-- input / select for the field -->
</div>
```

### D4H example values

| Placeholder | Value |
|-------------|-------|
| `FIELD_LABEL` | `D4H Personal Access Token` |
| `ARIA_LABEL` | `How to obtain a D4H Personal Access Token` |
| `HELP_LINK` | `https://api.team-manager.us.d4h.com/v3/docs#section/Introduction/Getting-Authenticated` |
| `LINK_TEXT` | `See D4H Instructions for Obtaining Personal Access Tokens` |

Docs: [D4H Team Manager API — Getting Authenticated](https://api.team-manager.us.d4h.com/v3/docs#section/Introduction/Getting-Authenticated).

---

## Script (click-outside close)

Use a **document click listener**, not `@vueuse/core`, so the plugin stays dependency-free beyond host packages.

```ts
import { onMounted, onUnmounted, ref } from 'vue';
import { IconInfoCircle } from '@tabler/icons-vue';

const fieldHelpOpen = ref(false);
const fieldHelpRef  = ref<HTMLElement | null>(null);

function onDocumentClick(event: MouseEvent): void {
    if (!fieldHelpOpen.value) return;
    const el = fieldHelpRef.value;
    if (el && !el.contains(event.target as Node)) {
        fieldHelpOpen.value = false;
    }
}

onMounted(() => {
    document.addEventListener('click', onDocumentClick);
    // …other onMounted work
});

onUnmounted(() => {
    document.removeEventListener('click', onDocumentClick);
});
```

### Why `@click.stop` on the icon and popup

- **Icon button:** stops the same click from bubbling to `document`, which would immediately close the popup.
- **Popup panel:** stops clicks on the link from being treated as “outside” (the panel is inside `fieldHelpRef`, but stopping propagation avoids edge cases with nested targets).

### Multiple help popups on one form

Use **unique** names per field, e.g. `tokenHelpOpen` / `tokenHelpRef`, `webhookHelpOpen` / `webhookHelpRef`. One shared `onDocumentClick` can close whichever is open:

```ts
function onDocumentClick(event: MouseEvent): void {
    for (const { open, ref } of [
        { open: tokenHelpOpen,  ref: tokenHelpRef },
        { open: webhookHelpOpen, ref: webhookHelpRef },
    ]) {
        if (!open.value) continue;
        const el = ref.value;
        if (el && !el.contains(event.target as Node)) {
            open.value = false;
        }
    }
}
```

Only one popup needs to be open at a time; toggling a second icon can explicitly close others if desired.

---

## Accessibility

- `aria-label` on the icon **button** (not the icon alone) — screen readers need a verb phrase, e.g. “How to obtain a …”.
- External links: always `target='_blank'` and `rel='noopener noreferrer'`.
- Keep link text descriptive (not “click here”).

---

## Styling notes (CloudTAK / Tabler)

- Reuse host classes: `form-label small fw-semibold`, `form-control form-control-sm`, `btn btn-link`.
- Popup: `bg-body border rounded shadow-sm small` — works in light/dark Tabler themes.
- `z-index: 1050` clears most in-plugin overlays; raise if clipped by a parent with `overflow: hidden` (prefer fixing the parent scroll container over hacking z-index).

---

## Related small tweaks (same PR)

When touching a config field, also check:

- **Placeholder examples** use generic IDs (`e.g. 123`), not real team/org IDs from development.
- **Label wording** matches vendor terminology (e.g. “Personal Access Token” vs “access token”).

---

## Verify before merge

From the plugin repo (symlinked under `~/CloudTAK/api/web/plugins/<name>/`):

```bash
bash scripts/check-like-docker.sh
```

Or manually from `~/CloudTAK/api/web`:

```bash
npx eslint --config eslint.config.js ./plugins/<plugin-name>/
npm run check   # must have zero errors under plugins/<plugin-name>/
npm run build
```

ESLint will flag unused imports (e.g. `IconInfoCircle` if template not wired) and Vue formatting issues — run `--fix` on the plugin path if needed.

---

## Checklist for agents

- [ ] Label text updated to final product wording
- [ ] `IconInfoCircle` imported from `@tabler/icons-vue`
- [ ] `ref` + `open` state + `onDocumentClick` + mount/unmount listeners
- [ ] `@click.stop` on icon button and popup
- [ ] No close button on popup
- [ ] External link has `target='_blank'` and `rel='noopener noreferrer'`
- [ ] `aria-label` on icon button
- [ ] ESLint clean on plugin path
- [ ] No `plugins/<plugin-name>/` lines in `vue-tsc` output
