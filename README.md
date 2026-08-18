# qm-exmlc — Quinn's More-Excellent XML Compare

A browser-based XML comparison tool that diffs XML *structurally* instead of
as text. The specific problem it solves: when a group of sibling elements
under the same parent is reordered but their data content is unchanged,
line/text-based diff tools report spurious adds, removes, or moves. This
tool matches sibling nodes by identity (id-like attributes, then content
hashing, then similarity) before comparing, so pure reordering never shows
up as noise — reordered-but-identical nodes render unchanged in their new
position with a small "moved" badge.

## Running it

No build step, no dependencies. Just open `index.html` in a browser —
double-click it or drag it into a browser window. Everything runs
client-side.

(If you'd rather serve it, any static file server works too, e.g.
`python3 -m http.server` from this directory — but it isn't required.)

## Using it

1. On the input page, provide the **old** and **new** XML documents, either
   by choosing a file / dragging a `.xml` file onto each drop zone, or by
   pasting XML text directly into the textarea.
2. Optionally, list attribute names to ignore for diffing purposes
   (comma-separated — e.g. `uuid, name`) in the **Ignore attributes**
   field. These attributes are excluded from node matching (so a volatile
   value, like a regenerated uuid, can't prevent two otherwise-identical
   nodes from being recognized as the same node) and default to
   unhighlighted — but they're still rendered, showing each side's actual
   value, and their real diff is still computed under the hood. A
   **Highlight ignored attrs** checkbox appears on the results page
   whenever a comparison used this field, letting you turn their
   highlighting back on live (no re-comparison) if you want to see them
   after all. This field is remembered across visits.
3. Click **Compare**. If either document fails to parse, an error appears
   inline and nothing navigates.
4. You're taken to a results page with two interchangeable views — **Side
   by Side** (old/new columns, each independently line-numbered and kept
   height-aligned even through additions/deletions, via a blank
   placeholder row on the opposite column) and **Unified** (git-style
   `+`/`-` with a dual old#/new# gutter) — toggled from the tool pane on
   the right, which stays pinned in view as you scroll a long diff. That
   pane also has a **Show moved** checkbox (hides "moved" badges/styling
   entirely — reordered-but-identical nodes then look exactly like
   unchanged content, instant, no re-comparison needed) and **Jump to
   change** controls: next/previous buttons with a position counter for
   each of Additions, Deletions, Modified, and Moves, for navigating a
   large diff without manual scrolling. A multi-line added or removed
   subtree counts as one jump target, not one per line.

Colors: green = added, red = removed, yellow = modified (only the specific
line that actually changed — a container element isn't painted just
because something inside it changed), blue = moved (content identical,
position changed). Word-level highlighting within a changed line shows
exactly which words/characters differ, not just that the line differs.
Lines never wrap (long lines scroll horizontally instead) so that
alignment between the two side-by-side columns always holds exactly.

## How the diff works

See `js/diff-engine.js` for the implementation. In short, for each set of
sibling nodes under a matched parent:

1. **Bucket** by (namespace, tag) — an `<item>` never matches a `<note>`.
2. **Match by id-like attribute** (`id`, `key`, `name`, `code`, `ref`) when
   a bucket consistently has one. A node that carries a value for that
   attribute but finds no match (e.g. `<book id="6">` vs `<book id="4">`)
   has declared its identity and failed to pair — it's excluded from
   Steps 3–4 below and reported as a real add/remove, however textually
   similar the two nodes might otherwise look.
3. **Match by exact content hash** for everything else — two subtrees with
   identical data (recursively, order-insensitive) hash equal regardless of
   their children's order, so a reorder is caught at the exact depth it
   happened, not misreported one level up.
4. **Match by similarity** (attribute overlap + text bigram similarity +
   child-tag overlap) for anything still unmatched, so a genuinely edited
   node shows as "modified" rather than a blunt delete+add.
5. Whatever's left is a real add or remove.
6. An LCS pass over the matched pairs' positions decides which are
   positionally stable (unchanged) vs. displaced relative to the rest
   (moved) — this is what triggers the moved badge, and it's the minimal
   set of moves needed to explain the reordering, not "everything that's
   not in its original slot."

Insignificant whitespace between elements is ignored; real text and
attribute content is compared exactly. Word-level diffing uses a
hand-rolled Myers diff (`js/text-diff.js`) — no external dependency.

## Files

```
index.html                  Input page (load/paste, Compare)
results.html                Results page (side-by-side + unified, toggle)
style.css                   Shared styles
js/xml-parser.js            DOMParser wrapping + canonical tree building
js/hash.js                  Order-sensitive + order-insensitive subtree hashing
js/diff-engine.js           The matching/diff algorithm
js/text-diff.js             Word-level Myers diff for text/attribute values
js/storage.js               sessionStorage handoff between the two pages
js/render-common.js         Shared DOM-building helpers for both renderers
js/render-sidebyside.js     Side-by-side renderer
js/render-unified.js        Unified renderer
js/input-page.js            Wires up index.html
js/results-page.js          Wires up results.html
```
