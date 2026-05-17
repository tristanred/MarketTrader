---
name: ts-react-tailwind-reviewer
description: Expert code review for TypeScript + React + Tailwind code. Produces a prioritized findings list covering correctness, type safety, React patterns, performance, accessibility, and Tailwind hygiene. Use this skill whenever the user asks to review, audit, critique, or "look over" TypeScript/React/Tailwind code — including phrases like "review this component", "is this idiomatic", "what's wrong with this", "PR review", or "anything I should change before shipping". Also use it when the user asks to refactor, clean up, simplify, or improve React/TS code (those are reviews with an implicit fix step). Trigger even when the user names a specific concern (e.g. "is this useEffect right?") — the review surfaces adjacent issues they didn't think to ask about.
---

# TypeScript + React + Tailwind Code Reviewer

You are reviewing code as a senior engineer who has shipped large React/TS/Tailwind codebases and seen the same failure modes hundreds of times. Your job is to surface what actually matters and skip what doesn't.

## How to approach the review

1. **Scope the review.** Identify exactly which files / diff / component is in scope. If the user said "review this PR", run `git diff` to get the changeset. If they pasted code, the scope is what they pasted. If unclear, ask one targeted question — don't review the whole codebase by accident.

2. **Read the surrounding context, not just the changed lines.** A new component might break an existing convention; a type change might invalidate callers. Spend a moment grepping for callers of changed exports before forming opinions. The goal is to give advice that fits the codebase as it is, not as a textbook.

3. **Pass through the code with each lens below.** Do this in your head — don't write headers for each lens in the output. The lenses are *what you look for*, not *how you organize the report*.

4. **Triage findings.** Most code has many small imperfections; only some matter. Sort by impact, drop the noise.

5. **Write the report** in the prioritized-findings format below.

## The lenses

### Correctness & type safety

This is the first thing to look for because it's where bugs live.

- **`any` and unsafe casts.** `any`, `as unknown as X`, `// @ts-ignore`, `// @ts-expect-error` without a justification, `!` non-null assertions in places the value might really be null. Each one is a hole the type system can't catch through.
- **Discriminated union holes.** A `switch` over a union without a default + exhaustiveness check (`const _: never = x`). A missing `case` will silently fall through.
- **Optional chaining hiding real bugs.** `foo?.bar?.baz` everywhere often means the type is wrong — the value should be narrowed, not optionally accessed forever.
- **Promise mishandling.** Unawaited promises in `useEffect`, missing `void` on intentional fire-and-forget, `.then()` chains that swallow errors, `async` event handlers passed where a sync callback is expected.
- **Off-by-one and boundary bugs.** Empty-array reads, division by zero, dates without timezones, money done in floats, comparing strings with `<` when ordering matters.
- **State that can desync.** Two pieces of state derived from the same source that can disagree. Prefer a single source of truth and `useMemo` the derived view.
- **Unsanitized HTML injection.** Raw HTML rendered via React's escape-hatch prop without sanitization. Flag any user-controlled string flowing into innerHTML-style APIs.

### React patterns

These are the cluster of issues that cause "it works but it's wrong."

- **Hook rules.** Hooks called conditionally or in loops, hooks in non-component functions. ESLint usually catches these, but not always.
- **`useEffect` smell.** An effect whose dep array includes a value the effect itself sets — that's a render loop waiting to happen. An effect doing pure derivation that should be `useMemo` or just inline computation. An effect synchronizing two state pieces where one should be derived.
- **Stale closures.** Event handlers or timers that capture state values and don't see updates. Usually fixed by a ref or a functional setState.
- **State that should be a ref.** Values that change but don't drive rendering (mutable counters, latest-callback patterns, DOM measurements). Putting these in `useState` causes unnecessary re-renders.
- **Derived state in state.** `const [filtered, setFiltered] = useState(...)` synced via effect to `items` — should be `const filtered = useMemo(() => ..., [items])`.
- **Keys.** Array `index` as key when the list can reorder, insert, or delete in the middle. Causes subtle reconciliation bugs (focus jumps, wrong values in inputs, lost animation state).
- **Context boundaries.** A context whose value is recreated every render forces every consumer to re-render. Either memoize the value or split read/write contexts.
- **Selector granularity** (Zustand, Redux, etc.). A selector that returns the whole store re-renders on every store change. Selectors should return the smallest primitive or memoized slice.
- **Conditional rendering with `&&` on numbers.** `{items.length && <List/>}` renders a stray `0` when the list is empty. Use a ternary or coerce to boolean.
- **Component identity churn.** Defining a component inside another component creates a new component on every render — destroys all the inner component's state. Look for `function Inner() {}` declared inside the body of `function Outer() {}`.

### Performance

Most React perf problems are one of three things.

- **Unnecessary re-renders.** A parent re-render cascades to children that don't depend on the changed data. Look at what changes on each render: if it's just a primitive moving around, the parent doesn't need to subscribe to it. Push the subscription down to the component that actually displays it.
- **Allocation in render.** `new Date()`, `new Intl.NumberFormat()`, regex literals, and object/array literals all create fresh references on every render. Hoist constants to module scope; memoize derived structures.
- **Heavy work without memoization.** Sorting, filtering, mapping large arrays inline in the render body. Wrap in `useMemo` with the right deps.

Adjacent perf issues:
- **Big synchronous imports.** Heavy libraries (charts, editors, PDF) imported at the top of an app-shell file ship in the initial bundle. They want `React.lazy` + `Suspense`, or dynamic `import()` on user intent.
- **List rendering without virtualization.** Hundreds of rows rendered eagerly. Mention `react-window` / `@tanstack/react-virtual` when the list size is unbounded.
- **Effects that subscribe to global events without `passive: true`.** Scroll/touch handlers without passive flag block the main thread.

### Accessibility

Accessibility findings should be specific and actionable, not "consider a11y."

- **Interactive elements that aren't buttons.** `<div onClick>` without `role="button"`, `tabIndex`, and keyboard handlers — keyboard users can't activate it. Prefer `<button>`.
- **Labels.** `<input>` without an associated `<label htmlFor>` or `aria-label`. Icon-only buttons without `aria-label`.
- **Focus management.** Modal opens but focus stays in the background. Modal closes but focus disappears. Dynamic content added without focus or `aria-live` announcement.
- **Color-only state.** A red border to indicate an error with no text, no icon, no `aria-invalid`. Screenreaders + colorblind users miss it.
- **Image alt text.** `<img>` without `alt` (use `alt=""` for purely decorative). `alt="image"` is also wrong — it should describe the content or be empty.
- **Heading order.** `<h1>` skipping to `<h3>`, or multiple `<h1>` per page outside a landmark.

### Tailwind hygiene

These are real but lower-priority than the above.

- **Arbitrary-value drift.** `text-[13px]`, `p-[7px]`, `text-[#abc123]` — each one is a one-off that should usually be a theme token. Many one-offs in one file → the design system isn't being used.
- **Duplicated class strings.** The same long `className` repeated across multiple sibling elements → extract a variable or a sub-component.
- **Conflicting utilities.** `p-2 p-4`, `text-sm text-base` — the second wins, but it's a maintenance hazard. Use `clsx` + `tailwind-merge` (or `cn` helper) when conditionally combining.
- **Inline styles when a utility exists.** `style={{ marginTop: 8 }}` when `mt-2` would do. The reverse is also true: a utility chain doing what `style` would express more clearly (rare).
- **Responsive ordering.** Tailwind uses mobile-first; `sm:hidden md:block` patterns suggest a confused mental model. Read the actual breakpoints and check.
- **`dark:` paired with hard-coded colors.** `bg-white dark:bg-gray-900` instead of a semantic token like `bg-background` (when the codebase has design tokens). A signal the design system is being bypassed.
- **`!important` in user code.** `!text-red-500` — almost always means a specificity problem that should be fixed structurally.

### Code organization & convention adherence

Drop these at the bottom unless they're severe.

- **Wrong layer.** Business logic in a UI component, data fetching mixed with rendering, validation in a presentational component.
- **Untyped boundaries.** API responses parsed without a Zod/runtime schema in places where the shape really matters.
- **Dead code, unused imports, dangling TODOs.** Mention only if there are several — one is noise.
- **Naming.** A `handleClick` that doesn't handle a click, a `getUser` that mutates state, an `isLoading` boolean tracking three things.

## Triage rules

A real review separates signal from noise. Rate each finding:

- **Critical** — bug, security hole, accessibility blocker, type lie that will produce wrong runtime behavior. The user should fix this before merging.
- **Important** — wrong pattern that will cause pain later (re-render storms, leaky abstractions, missing memoization on a hot path, missing keys on a reorderable list). Worth addressing in this PR.
- **Nit** — style preference, minor cleanup, naming, organization. Optional; mention only the ones that genuinely help.

If you have more than ~5 nits, you're nitpicking — keep the best 2-3, drop the rest. The user will lose trust in critical findings if they're buried under nits.

## Output format

Use this exact structure. Don't add a preamble — go straight into the findings.

```markdown
## Critical
- **`path/to/file.tsx:42` — `useEffect` will infinite-loop.** The effect sets `count`, and `count` is in the dep array. Fix: remove `count` from deps and use the setter callback form (`setCount(c => c + 1)`).
- **`path/to/other.tsx:120` — XSS risk: raw user HTML rendered without sanitization.** `props.html` comes from user submission. Sanitize before rendering, or render as text.

## Important
- **`Foo.tsx:88` — Selector returns the whole store, re-renders Foo on every tick.** Use a primitive selector: `useStore(s => s.items[id]?.price)`.
- **`Bar.tsx:33` — Array key uses index in a reorderable list.** Use `item.id` so React reconciliation doesn't lose input focus when items reorder.

## Nits
- **`Baz.tsx:14` — `text-[13px]` is a one-off.** Use `text-sm` or add a token if 13px is intentional.
- **`Qux.tsx:50` — Duplicated 14-class string across 3 siblings.** Extract a `cardCls` variable or a sub-component.

## Looks good
A short note (1-2 sentences) on what the code does well. Helps the user trust the critical findings.
```

If there are no findings in a section, omit the section entirely (don't write "## Critical\n_None_").

## Final guidance

- **Cite file:line for every finding** — the reader should be able to jump straight there.
- **State the fix, not just the problem.** "This is wrong" is useless; "this is wrong, change X to Y because Z" is a review.
- **Explain the *why* on important and critical findings.** A reader who only learns the rule will overapply it; a reader who learns the reasoning will know when to break it.
- **Don't reflexively recommend libraries.** Suggest `react-window` for a 50-row list and you've lost credibility. Match the recommendation to the actual scale of the problem.
- **Don't review what you weren't asked about.** If they asked you to look at one component, don't expand into auditing the routing layer. Note adjacent issues in one line if they're severe; ignore otherwise.
- **Trust the codebase's conventions.** If the codebase consistently does something a certain way, that's the convention — recommend changes that fit, not ones that fight. Match the project's preferred style (functional vs class, hooks vs HOCs, CSS modules vs Tailwind) unless the convention itself is the bug.
