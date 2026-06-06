// Equipment category filter — the plugin only surfaces these categories.
//
// D4H equipment categories are *team-defined* free-text titles (not a fixed
// enum), and can vary in spelling/casing per instance, so we match TOLERANTLY:
// a category is wanted if its lowercased title contains one of the keywords
// below. The sync's "discovery" step (see d4h-roster.ts) reports every distinct
// category title it actually saw, plus which were included — so if a wanted
// keyword matches nothing (e.g. D4H calls it "Litters" not "Tech Litter"), you
// get a warning naming the real labels and can adjust this list in one place.
//
// This is the AUTHORITATIVE filter. A server-side `?category=` request filter
// can be layered on later once the discovered category ids/labels are confirmed
// (see plan §8); until then we fetch all equipment and filter here.

export const WANTED_CATEGORY_KEYWORDS = ['vehicle', 'uas', 'tech litter'] as const;

/** True if a D4H category title matches one of the wanted keywords. */
export function categoryIsWanted(category: string | undefined): boolean {
    if (!category) return false;
    const c = category.toLowerCase();
    return WANTED_CATEGORY_KEYWORDS.some(k => c.includes(k));
}
