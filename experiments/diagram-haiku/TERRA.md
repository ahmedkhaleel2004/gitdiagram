# Diagrams on GPT-6.1 Terra instead of GPT-6 Luna? (2026-10-26)

**Verdict: better diagrams, but not worth switching.** Terra (released that
day, $1 in / $5 out, 10x Luna) drew diagrams a blind judge found clearly more
accurate, but each one costs about 11 times as much and takes more than twice
as long.

Same harness and judge as `README.md`: 9 repositories x 3 samples per arm, the
production single-pass prompt and schema, OpenAI's normal lane (what production
uses now), judged blind by GPT-6 Sol. Run with
`bun experiments/diagram-haiku/run-all.ts 3 luna-std,terra-low,terra-medium`.

|                                     | luna-std (production) | terra-low           | terra-medium    |
| ----------------------------------- | --------------------- | ------------------- | --------------- |
| Hard failures                       | 0/27                  | 0/27                | 0/27            |
| Nodes / edges per diagram           | 20.7 / 22.4           | 25.1 / 28.8         | 27.6 / 31.9     |
| Judge: edges not backed by code     | 141/605 (23.3%)       | **123/777 (15.8%)** | 167/860 (19.4%) |
| Judge: solid arrows not backed      | 102/512 (19.9%)       | **84/628 (13.4%)**  | 105/656 (16.0%) |
| Judge: contradicted edges           | 39                    | **7**               | 6               |
| First explanation text, median      | 3.6 s                 | **1.6 s**           | 6.5 s           |
| Total model time, median (p90)      | **13.3 s (17.3 s)**   | 29.1 s (32.7 s)     | 38.2 s (46.2 s) |
| Cost per diagram, first-time prompt | **$0.0025**           | $0.0279             | $0.0331         |

- Terra low beat Luna on 7 of 9 repositories (lost on flask, tied on react).
- Why it is slow: it writes about 50% more output (bigger diagrams) at a lower
  token rate. Reasoning is not the cost (median 48 reasoning tokens at low).
- Production would also need code changes: the single-pass path and its 18 s
  slow-retry (`ARCHITECTURE_SLOW_RETRY_MS`) are Luna-only, and 24 of 27 Terra
  calls ran past 18 s.
- Estimate, not measured: recent diagram spend of about $3.5 a day would become
  about $40 a day (roughly $1,100 a month more).
- The first judge pass scored Terra's 6 AgentBridge runs with no code shown
  (every edge "No source or README evidence"); they were re-judged and the
  table uses the re-judged numbers.
