# GitDiagram animation plans

These plans were audited against the UI at commit `3078b4b`. Execute them in
order: the shared motion vocabulary in 001 is reused by every later plan.

| Plan | Title                                          | Severity | Status |
| ---- | ---------------------------------------------- | -------- | ------ |
| 001  | Unify responsive control motion                | HIGH     | DONE   |
| 002  | Give the mobile menu a spatial transition      | MEDIUM   | DONE   |
| 003  | Tighten tooltip and dialog motion              | MEDIUM   | DONE   |
| 004  | Make state changes legible without moving data | HIGH     | DONE   |

Dependencies: 002-004 depend on the easing tokens introduced by 001. The
plans do not add a motion dependency; predetermined motion stays in CSS.
