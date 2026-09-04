---
name: design-director
description: A product-aware UI/UX and frontend design workflow for creating distinctive, usable, polished digital experiences without falling into generic AI-generated web design patterns. Use when designing, redesigning, or implementing a web interface.
---

# Design Director — v0.1

## Core principle

Do not optimize for "pretty UI" alone.

Design the product as a complete digital experience: useful, understandable, distinctive, responsive, accessible, performant, visually coherent, and appropriate to its product and users.

References are evidence, not templates. Never copy a reference site's distinctive layout, component arrangement, colors, typography, or aesthetic merely because it looks good. Extract underlying principles and apply only the principles that fit the current product.

## 1. Understand before designing

Before implementation, establish:
- What is the product?
- Who is the primary user?
- What is the user's main job-to-be-done?
- What are the 1–3 most important actions?
- What information does the user need first?
- What should feel fast, calm, precise, playful, powerful, trustworthy, etc.?
- What constraints exist (device, data density, accessibility, performance)?

Do not begin by choosing components.

## 2. UX comes before decoration

Design the user's journey before styling it. Consider information architecture, navigation, hierarchy, discoverability, cognitive load, progressive disclosure, interaction cost, feedback, error recovery, empty/loading/success states, destructive actions, undo/reversibility, mobile behavior, and keyboard behavior.

For important actions, define the complete interaction: initial → hover/focus → active → loading → success/error → recovery.

A screenshot-perfect interface that is frustrating to operate is not a successful design.

## 3. Establish a product-specific design direction

Choose a visual and interaction direction based on the product. Possible directions include editorial, minimal, cinematic, technical, industrial, scientific, luxury, playful, expressive, brutalist, retro-futurist, calm/instrumental, or experimental.

Do not default to "futuristic". Futuristic does NOT automatically mean neon gradients, purple/blue AI colors, glassmorphism, glowing blobs, excessive blur, or floating cards. The product determines the aesthetic.

## 4. Build a real visual system

### Color
Define background, surfaces, elevated surfaces, primary/secondary/muted text, borders/dividers, accent, and semantic success/warning/error/info. Color must establish hierarchy or meaning. Avoid decorative color noise. Check contrast and readability.

### Typography
Choose typefaces and hierarchy appropriate to the product. Define display, heading, body, labels, metadata, line-height, weight hierarchy, and tracking where appropriate. Do not automatically use Inter/Roboto/system sans simply because it is convenient.

### Spatial system
Use a coherent spacing rhythm, but do not force every section into identical card grids. Use whitespace deliberately.

### Shape/material
Define corner treatment, borders, shadows, elevation, texture, imagery, and transparency. Use these to establish a consistent material language.

## 5. Composition

Do not mechanically assemble navbar → hero → three cards → feature grid → footer.

Ask: What should the eye see first? What is the visual anchor? How does one section transition into the next? Can typography, imagery, data, or interface elements create continuity? Is symmetry actually useful? Would asymmetry improve hierarchy? Is a section needed at all?

Distinctive composition is encouraged, but novelty must serve communication.

## 6. Motion and interaction

Motion is optional, purposeful, and product-specific. Use animation when it communicates state, establishes spatial relationships, provides feedback, improves continuity, helps comprehension, or adds appropriate personality.

Do NOT animate everything. Avoid gratuitous parallax, excessive entrance animations, long waits for basic actions, bouncing without purpose, and animation that blocks interaction. Prefer efficient animation techniques such as transform and opacity when appropriate. Respect `prefers-reduced-motion`.

The page does not need to be a "scroll experience". A static interface can be excellent.

## 7. Responsive design

Mobile is not merely desktop made smaller. Reconsider navigation, information density, control placement, content priority, interaction targets, charts/tables, sticky elements, and scrolling behavior. Preserve user goals and hierarchy even when composition changes substantially.

## 8. Anti-AI-slop check

Before accepting a design, actively inspect for generic SaaS layouts, oversized generic heroes, excessive rounded cards, meaningless gradients, unjustified purple/blue AI styling, unnecessary glassmorphism, decorative glowing blobs, repetitive cards, excessive centered content, generic copy, excessive shadows, too many visual effects, familiar components included without purpose, inconsistent spacing, colors without semantic purpose, and animations without purpose.

Ask: "If the logo disappeared, would this still have a recognizable product identity?" If not, reconsider the art direction.

## 9. Self-critique before completion

Never treat generated code as proof that the design is good. After implementation, review the actual rendered interface.

### Visual audit
Hierarchy, typography, color, spacing, composition, consistency, visual identity.

### UX audit
Can a new user understand what to do? Are primary actions obvious? Is navigation predictable? Are states understandable? Is information overload controlled? Can users recover from mistakes?

### Interaction audit
Hover/focus/active states, loading, errors, empty states, transitions, feedback.

### Responsive audit
Desktop, tablet, mobile, touch targets, overflow, content priority.

### Accessibility audit
Contrast, keyboard navigation, focus visibility, semantic structure, reduced motion, labels and accessible names.

### Performance audit
Unnecessary animation, layout shifts, oversized assets, expensive effects, avoidable rendering work.

Fix the weakest issues before declaring the interface finished.

## 10. Reference interpretation

When references are provided, extract:
1. What makes the reference effective?
2. Which principles are transferable?
3. Which details are specific to that product?
4. Which details should NOT be copied?
5. How could the principle be expressed differently for the current product?

References should increase design quality, not reduce design diversity.

## 11. Decision hierarchy

When tradeoffs occur, generally prioritize:
1. user understanding
2. task completion
3. accessibility
4. information hierarchy
5. responsiveness
6. performance
7. visual quality
8. novelty

Do not sacrifice usability merely to make something look impressive.

## 12. Working loop

UNDERSTAND → DEFINE UX → ESTABLISH ART DIRECTION → DESIGN SYSTEM → COMPOSE → IMPLEMENT → INSPECT → CRITIQUE → ITERATE

Do not skip INSPECT → CRITIQUE → ITERATE merely because the code compiles.

## Final standard

The goal is not: "Make something that looks impressive in a screenshot."

The goal is: "Make something that feels deliberately designed when a real person uses it."
