# CloudTAK plugin pattern: status badges (active / inactive)

Reusable **Tabler/Bootstrap badge** styling for “in good standing” vs “inactive / excluded / expired” items. Use the same classes everywhere (personnel qualifications, equipment categories, modal summaries) so status reads consistently at a glance.

Reference implementations in this plugin:

- Personnel qualifications (hover popup + row count chip): `components/HomeView.vue`
- Equipment categories (“Categories found” row): `components/HomeView.vue`

---

## When to use

- A list of named items where some are **current / included / valid** and others are **not**.
- Modals or detail panels that show tags, qualifications, categories, or filter results.
- You want green = good, gray + strikethrough = not applicable — without custom CSS.

Do **not** use `bg-light text-muted border` for inactive items if you are mirroring this pattern; use the secondary + strikethrough pair instead.

---

## Semantics

| State | Meaning (examples) | Classes |
|-------|-------------------|---------|
| **Active** | Valid qualification; equipment category kept by sync filter | `badge bg-success text-white` |
| **Inactive** | Expired qualification; category not in wanted set | `badge bg-secondary text-white text-decoration-line-through` |

Optional `title` tooltips explain *why* an item is inactive (expiry date, filter rule, etc.).

---

## Layout

Wrap a group of badges in a flex row so they wrap on narrow panels:

```html
<div class='d-flex flex-wrap gap-1'>
    <!-- badge spans -->
</div>
```

For a labeled row (equipment categories):

```html
<div class='d-flex flex-wrap gap-1 align-items-center'>
    <span class='text-muted me-1'>Categories found:</span>
    <!-- badges -->
</div>
```

---

## Template: status badge list

Replace `items`, `item.key`, `item.label`, and your active/inactive condition.

```vue
<div class='d-flex flex-wrap gap-1'>
    <span
        v-for='item in items'
        :key='item.key'
        class='badge'
        :class='item.active
            ? "bg-success text-white"
            : "bg-secondary text-white text-decoration-line-through"'
        :title='item.active ? item.activeHint : item.inactiveHint'
    >{{ item.label }}</span>
</div>
```

### Personnel qualification (per-item, with expiry)

```vue
<span
    v-for='q in member.qualifications'
    :key='q.id'
    class='badge'
    :class='isExpired(q)
        ? "bg-secondary text-white text-decoration-line-through"
        : "bg-success text-white"'
    :title='q.expiresAt
        ? ((isExpired(q) ? "Expired " : "Expires ") + q.expiresAt.slice(0, 10))
        : "No expiry on record"'
>{{ q.name }}</span>
```

```ts
function isExpired(q: { expiresAt?: string }): boolean {
    return !!q.expiresAt && new Date(q.expiresAt).getTime() < Date.now();
}
```

### Equipment category (included vs filtered out)

```vue
<span
    v-for='c in equipmentCategories'
    :key='c.title'
    class='badge'
    :class='c.included
        ? "bg-success text-white"
        : "bg-secondary text-white text-decoration-line-through"'
    :title='c.included
        ? "Kept by the vehicles / UAS / tech-litter filter"
        : "Not in the wanted categories"'
>{{ c.title }} ({{ c.count }})</span>
```

If excluded categories are missing from the wanted set, adjust keywords in `lib/d4h-equipment-categories.ts`.

---

## Template: inline count chip (row summary)

Small green count next to a name when detail exists on hover or in a modal:

```vue
<span
    v-if='member.qualifications?.length'
    class='badge bg-success text-white ms-1'
    style='font-size:0.65em;vertical-align:middle'
    :title='member.qualifications.length + " qualification(s) — hover to view"'
>{{ member.qualifications.length }}</span>
```

Use the same `bg-success text-white` chip whenever the count represents “N active items available to inspect.”

---

## Hover popup container (personnel)

Qualifications use a fixed card so content is not clipped by `overflow:auto` on the table. Pattern:

```vue
<div
    v-if='hoverDetail'
    class='card shadow'
    :style='{
        position: "fixed",
        left: hoverDetail.x + "px",
        top: hoverDetail.y + "px",
        zIndex: 1080,
        width: "300px",
        maxHeight: "260px",
        overflow: "auto",
        pointerEvents: "none",
    }'
>
    <div class='card-header py-1 px-2 small fw-semibold'>
        {{ hoverDetail.title }}
    </div>
    <div class='card-body py-2 px-2'>
        <div class='d-flex flex-wrap gap-1'>
            <!-- status badges here -->
        </div>
    </div>
</div>
```

`pointer-events: none` keeps hover dismiss simple: moving toward the popup still counts as leaving the row.

Modals can reuse the **badge classes only** inside a normal `modal-body` — no fixed positioning required.

---

## Styling notes (CloudTAK / Tabler)

- Base element: `<span class='badge'>` (not pill buttons).
- Always pair `bg-success` / `bg-secondary` with `text-white` for contrast in light and dark Tabler themes.
- Inactive state **always** includes `text-decoration-line-through` so color-blind users get a second cue.
- No plugin-local `<style>` blocks required — host utility classes only.

---

## Related pattern: two-level tab navigation

Main vs sub tabs in `HomeView.vue` use a different control (buttons, not badges):

| Level | Control | Classes |
|-------|---------|---------|
| Main (3 tabs) | Filled bar | `btn btn-sm … bg-primary text-white fw-semibold` (active) / `text-muted` (inactive) |
| Sub (3 pills) | Outlined buttons | `btn btn-sm btn-outline-warning` + `{ active: … }` |

See inline comments in `components/HomeView.vue` near `mainTabs` / sub-tab rows when adding new grouped sections.

---

## Verify before merge

```bash
bash scripts/check-like-docker.sh
```

Or from `~/CloudTAK/api/web` with `PLUGIN_SLUG=d4h` if the plugin symlink is `plugins/d4h`.

---

## Checklist for agents

- [ ] Active items: `badge bg-success text-white`
- [ ] Inactive items: `badge bg-secondary text-white text-decoration-line-through`
- [ ] Group layout: `d-flex flex-wrap gap-1`
- [ ] Meaningful `title` on badges when the reason for inactive state is not obvious
- [ ] Modals: same badge classes inside `modal-body` (no one-off gray outline badges)
- [ ] ESLint clean on plugin path
