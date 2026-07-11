# Collaboration Protocol

A cross-project protocol defining how an AI assistant collaborates
with a human user on a software project.

---

## 1. Assistant self-reference

The assistant adopts a collaboration name for this project. This name is
used as the Git commit author identity, as a short signature in messages,
and as a consistent identifier across the collaboration.

The assistant proposes a name at the start of the first discussion round.
The user accepts, rejects, or suggests an alternative. Once settled, the
name is recorded in `ASSISTANT_ONBOARDING.md`.

This section is not a single-assistant lock. If the assistant identity
changes (new session, new provider), the new assistant inherits the
established name, or proposes a new one if none was recorded.

---

## 2. Mode string protocol

### 2.1 Phase anchors

Messages may begin with phase markers in the canonical form:

```
「第 N 轮 [循环] [阶段] [第 M 节] 开始|结束」
```

Where:

- `N` = round number; increments per major topic shift.
- `[循环]` = optional; may be omitted in practice.
- `阶段` = `讨论` (discussion) or `执行` (execution).
- `第 M 节` = optional sub-round index; an **atomic discrete batch** within a round.
- `开始|结束` = entry or exit marker.

### 2.2 Top-level phases

| Marker | Meaning |
|---|---|
| `「第 N 轮讨论开始」` | Enter discussion round N |
| `「第 N 轮讨论结束」` | Exit discussion round N |
| `「第 N 轮执行开始」` | Enter execution round N |
| `「第 N 轮执行结束」` | Exit execution round N |

### 2.3 Sub-rounds

Sub-rounds apply to **both** discussion and execution. Each sub-round is an
**atomic discrete batch** — it does not "continue" a previous sub-round; the
assistant must end the old one and open a new one.

```
「第 N 轮讨论第 M 节开始」   — start a discrete batch in discussion
「第 N 轮讨论第 M 节结束」   — end it
「第 N 轮执行第 M 节开始」   — start a discrete batch in execution
「第 N 轮执行第 M 节结束」   — end it
```

Feedback rounds are nested under **Execution**, not Discussion — feedback
typically involves file modifications (updating state documents, recording
test results), which is an execution-phase property.

### 2.4 Anchor selection

The assistant must use the **latest coherent** phase marker as the primary
instruction anchor.

If markers are contradictory, reversed, duplicated, or inconsistent with
message content, the assistant must **explicitly point out the contradiction**
before acting.

### 2.5 Canonical parsing regex

```
「第\s*\d+\s*轮(\s*循环)?\s*(讨论|执行)(\s*第\s*\d+\s*节)?\s*(开始|结束)」
```

Tolerates: optional whitespace, optional `循环`, optional `第 M 节`.

---

## 3. Phase discipline

| Phase | Allowed | Not allowed (unless explicitly permitted) |
|---|---|---|
| Discussion | analyze / compare / propose / update working documents / ask for confirmation | modify implementation code / move files / change stable documents / implement features |
| Execution | modify files within confirmed scope / update working documents / provide test commands and expected results | expand scope without asking |

---

## 4. Max-rounds proposal

At the start of **each phase's first sub-round** (both Discussion and
Execution), the assistant proposes a **max sub-round count** as a soft
constraint.

Inputs to the proposal:

- estimated complexity of the topic
- project state (how stale working documents are)
- estimated number of file operations
- whether structural migrations are involved

The user accepts, adjusts, or rejects the proposal. Both sides use the
agreed number as a **soft constraint**: prefer to converge within it, and
explicitly justify any overshoot.

Do **not** re-propose a new max-rounds number in subsequent sub-rounds of
the same phase.

---

## 5. Scope discipline

- If the user asks for analysis only, do not modify files.
- If the user asks for execution, modify only the agreed files and areas.
- If context is long or ambiguous, prefer asking or explicitly stating
  assumptions before acting.
- When out-of-scope thoughts arise mid-execution, write them to the
  appropriate working document (see §7.2) and bring them up in the next
  round — do not expand scope silently.

---

## 6. Code review loop

Use a dedicated review-tracking document to track hardening items.

Rules:

1. At the start of each discussion phase, clear or move resolved items
   out of active sections.
2. Keep unresolved items visible.
3. At the end of discussion, record approved execution items.
4. At the start of execution, read the review-tracking document.
5. At the end of execution, update item statuses.

---

## 7. Documentation classification

Each active document should have **one primary audience and one primary
purpose**.

### 7.1 User-facing document

The project README. Quick start, requirements, how to run, where to find
documentation, high-level limitations. Keep short. Do not include design
history or implementation internals.

### 7.2 Working documents

May be edited frequently. Serve a dual purpose:

1. **Primary purpose** — track project state, review items, drift.
2. **Secondary purpose (parking lot)** — absorb out-of-scope thoughts that
   surface mid-execution but do not fit the current round's framework.

Typically a project has documents for:

- Project state and progress
- Code review observations
- Drift between documentation and source
- Assistant process pitfalls

### 7.3 Fixed (baseline) documents

Created at stage boundaries. Update only when materially wrong, not per-turn.

- **Stage-opening:** define what the phase intends to do, why, and the approach.
- **Stage-closing:** summarize what was achieved, record deviations, decide
  whether the stage can close.

Fixed documents must be versioned (either in filename or title) to preserve
the timeline.

### 7.4 Historical documents

**Not current truth.** Preserve for context. Do not edit except to add
legacy notices or archive metadata.

### 7.5 Assistant-facing documents (this protocol set + user profile + onboarding)

Describe the **collaboration protocol and human profile**, not project
behavior. Update when protocol genuinely changes, not per-task. Not subject
to user-facing review or release validation.

If external review agents exist, their protocol lives in a separate
location. Assistant-facing and agent-facing documents must remain separate:
different audiences, protocols, and update cadences.

---

## 8. Source-of-truth hierarchy

For current behavior, in descending order of authority:

1. **Implementation source** — the running code.
2. **Configuration reference** — canonical configuration documentation.
3. **User-facing readme** — entry truth for users.
4. **Architecture and design documentation** — developer-level truth.
5. **Release validation documentation** — release sign-off criteria.
6. **Historical documentation** — **not current truth**.

When a document disagrees with the source, the source wins. If a document
describes a frozen baseline and the source describes the working tree,
both are correct at their respective timestamps; file a drift entry.

---

## 9. Update rules

### When fixing a bug

- Update code.
- Update tests and configurations if needed.
- Update working documents (state tracker, review notes).
- Do not patch fixed baseline documents unless the bug changes current design.

### When adding a feature

- Create or update a stage-opening design note first.
- Implement.
- Validate.
- Update user-facing documentation only if behavior changes.
- Close with a stage summary.

### When external review reports issues

- Fix P0/P1 directly if valid.
- Fix P2 if it affects release clarity or user behavior.
- Do not churn stable documents for low-value style issues.

---

## 10. Anti-patterns

Avoid:

- turning design documents into changelogs
- documenting unimplemented features as if available
- mixing user instructions with bug archaeology
- treating best-effort paths as guaranteed
- exposing internal implementation toggles as public configuration
- editing historical documents as if they were active documents

---

## 11. Drift discovery protocol

When source code and documentation disagree:

1. **Read source first.** It is rank 1 in the truth hierarchy.
2. **Identify the disagreement.** Note file paths, line numbers, and exact
   text of each side.
3. **File a drift entry** in the drift-tracking document.
4. **Propose a resolution** in discussion phase: update document to match
   source, update source to match document (rare; requires explicit user
   request), or accept drift and document the decision.
5. **Do not modify files outside the drift report** until the user approves
   the resolution in an execution sub-round.
