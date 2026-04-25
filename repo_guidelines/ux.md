**UX Best Practices Guide**  
**Sectioned principles for intuitive, low-friction interfaces**

### 1. Core Design Goals
- **Lower cognitive load**: Use fewer always-visible sections, tighter visual grouping, and reduce the need for simultaneous scanning across elements.
- **Minimize decision friction**: Make high-level choices (e.g., proof-suite run vs. manual run) explicit and mutually exclusive rather than blended together.
- **Establish clear visual hierarchy**: Surface the primary action first, demote advanced controls, and give manual presets clear scoping (visible only when relevant).
- **Improve feedback & recovery**: Keep action/status areas sticky and visible; automatically reveal hidden sections on errors (e.g., JSON validation failures).
- **Ensure UX consistency** (new dedicated principle): Every similar component must follow identical layout, spacing, typography, alignment, and labeling patterns. Inconsistent cards or panels force users to re-learn the interface on every glance.

**Example of inconsistency to avoid**:  
The “Averages” dashboard shows four side-by-side cards for related runtime configurations. While the high-level intent is the same, the internal layout varies subtly:
- “Observed runtime bucket” label placement and styling differ.
- Prompt-time / prompt-speed metrics shift position and visual weight.
- Long command-line strings at the bottom are truncated or wrapped inconsistently.
- Some cards show extra “Requested labels” text while others don’t.
This creates unnecessary scanning and comparison work—exactly what consistency rules are designed to prevent.

### 2. Progressive Disclosure & Flow Structure
- Design modal or multi-step flows as **explicit stages**, not one long scrolling page with conditional messages.
- Make stage containers **mutually exclusive by layout** (e.g., tabs, separate cards, or stepped wizard), not just by copy.
- Show **one primary decision at a time**. Secondary or advanced controls must remain hidden until the user commits to a path.
- Keep the first screen **action-oriented**: path selection → configuration → advanced options.
- Place advanced controls inside a **collapsed section by default**; auto-expand only on validation errors.
- **Reset modal state on every reopen** so users always start from the simplest entry point.
- Validate **progressive-disclosure behavior visually** after every layout change—never rely solely on `hidden` attributes when the component also uses `display: grid`, `flex`, or `block`.

### 3. Cognitive Load & Decision Making
- **Avoid cognitive overload**: Never present too many options, metrics, or visual elements at once. Group related data tightly and hide what isn’t immediately needed.
- **Eliminate decision friction**: Remove unnecessary choices or steps that slow users down. Default to the most common path.
- **Prevent choice paralysis**: Avoid too many equally weighted decisions or options. Use visual hierarchy and smart defaults so users aren’t forced to evaluate every option with equal effort.
- **Create clear affordances**: Every button, icon, label, and interactive element must be instantly understandable—no unlabeled icons or hidden actions.

### 4. Interaction, Feedback & Consistency
- **Provide immediate system feedback**: Always show loading states, status messages, and confirmations so users never wonder “what just happened?”
- **Enforce interface consistency**: Use the same button styles, iconography, navigation patterns, card layouts, and terminology everywhere.
- **Deliver excellent error handling**: Replace cryptic messages with plain-language guidance and clear recovery paths. Never blame the user.

### 5. Flow & Performance
- **Avoid interruptive patterns**: Use modals, pop-ups, or blocking dialogs sparingly and only when they add clear value.
- **Remove forced actions**: Never gate core functionality behind account creation, email sign-ups, or extra steps unless absolutely required.
- **Optimize performance**: Ensure load times stay under 2–3 seconds and interactions feel instantaneous. Janky or slow UIs destroy even the best visual design.

### 6. Trust, Ethics & Inclusivity
- **Avoid dark/manipulative patterns**: Never make the user’s preferred choice harder to find (e.g., hidden cancel buttons, pre-checked subscriptions, fake urgency).
- **Meet accessibility standards (WCAG)**: Provide sufficient contrast, large touch targets, full keyboard navigation, proper alt text, and responsive layouts. Great UX works for everyone.

### 7. Mobile Experience
- **Reduce clutter**: Aggressively minimize visible elements on smaller screens—collapse secondary content, hide non-essential UI, and prioritize only the most critical actions and information.
- **Ensure touch-friendly targets**: All interactive elements must be at least 44×44 px with adequate spacing to prevent accidental taps.
- **Prioritize content above the fold**: Surface primary actions and key information first; keep critical flows short and minimize unnecessary scrolling.
- **Support one-handed use**: Place primary CTAs and navigation within easy thumb reach (typically bottom or center on portrait orientation).
- **Maintain cross-device consistency**: Core components, flows, and terminology must behave predictably between mobile and desktop while respecting each platform’s conventions.

**Implementation tip**: After any layout update, perform a quick consistency audit by placing similar components (cards, forms, data tables) side-by-side and checking for alignment, spacing, typography, and labeling differences. Fix every deviation before shipping.