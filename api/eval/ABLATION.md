# Ablation: what each stage is worth

Rebuilt by `python -m eval.ablate`. Production's pipeline with one stage removed at a time.

## Retrieval

| Removed | Ranked first | Reached the model | …held-out test | Follow-ups reached | Exact terms reached | Characters sent |
|---|---|---|---|---|---|---|
| (nothing removed: production) | 64.3% | 92.9% | 88.9% | 83.3% | 92.0% | 3974 |
| query prefix | 62.2% | 90.8% | 86.1% | 83.3% | 92.0% | 3980 |
| keyword search | 62.2% | 83.7% | 88.9% | 72.2% | 80.0% | 3950 |
| follow-up rewrite | 61.2% | 87.8% | 86.1% | 55.6% | 92.0% | 3968 |
| adjacent promotion | 64.3% | 89.8% | 86.1% | 72.2% | 92.0% | 3942 |
| six chunks (back to four) | 64.3% | 85.7% | 83.3% | 83.3% | 88.0% | 2768 |
