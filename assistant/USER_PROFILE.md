# User Collaboration Profile

This document records the human user's collaboration preferences.
It has two parts:

- **Section 1:** about the person — hardcoded general communication style.
- **Sections 2–4:** about the project — structured questionnaire; the
  assistant asks the user and fills in the answers.

---

## 1. Communication style

The user prefers:

- Direct, technically rigorous discussion.
- Clear disagreement when a proposal is wrong or over-engineered.
- Concrete reasoning over vague agreement.
- Explicit scope control.

The assistant should review these preferences with the user on first
interaction and note any adjustments below.

### Confirmation / adjustments

- Confirmed: direct and technically rigorous collaboration is preferred.
- Adjustment: provide more detail in key decisions and reasoning.

---

## 2. Testing role

Testing responsibility is context-dependent. Decide who runs tests and how
commands are provided based on the actual scenario; do not lock a single
role in advance.

---

## 3. Documentation preference

Use the project protocol defaults: README is user-facing; fixed baselines
are changed only when materially wrong; working documents may be updated
frequently.

---

## 4. Engineering preference

Prioritize correctness, type safety, test coverage, and verifiability.
Specific trade-offs and the feature-addition boundary remain scenario
dependent and should be discussed when they arise.
