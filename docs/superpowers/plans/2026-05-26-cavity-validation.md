# Cavity Validation — Server-Side Explicit Rule — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit `body('Cavity')` validation rule to `orderValidation` in the server so the Cavity field is officially sanitized as a bounded integer on every create/update request.

**Architecture:** One-line addition to the existing `orderValidation` array in `server/routes/orders.cjs`. No DB, client, or API contract changes — the rest of the pipeline is already correctly wired.

**Tech Stack:** Node.js, Express, express-validator v7.

> **No test framework** is configured in this project. Verification is manual via the running server.

---

## File Map

| File | Change |
|---|---|
| `server/routes/orders.cjs` | Add `body('Cavity')` rule to `orderValidation` array |

---

## Task 1: Add `body('Cavity')` rule to `orderValidation`

**Files:**
- Modify: `server/routes/orders.cjs:103–104`

### Steps

- [ ] **Step 1: Add the validation rule**

Find this block (around line 103–104):
```js
    body('Mandrels per Cavity').optional().isInt({ min: 0, max: 10000 }).withMessage('Invalid mandrels per cavity'),
    body('Total Mandrels').optional().isInt({ min: 0, max: 100000 }).withMessage('Invalid total mandrels'),
```

Replace with:
```js
    body('Mandrels per Cavity').optional().isInt({ min: 0, max: 10000 }).withMessage('Invalid mandrels per cavity'),
    body('Cavity').optional().isInt({ min: 0, max: 10000 }).withMessage('Invalid cavity count'),
    body('Total Mandrels').optional().isInt({ min: 0, max: 100000 }).withMessage('Invalid total mandrels'),
```

- [ ] **Step 2: Verify manually**

Restart the server (`npm run server:dev`). Import a PDF with a known cavity count (e.g., "No OF CAV = 4"). After import, open the **Orders** page and confirm the `Cav` column shows `4` for that order.

Optionally, send a bad payload via curl to confirm rejection:
```bash
curl -s -X PUT http://localhost:3000/api/orders/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"Cavity": -5}' | jq .
```
Expected: `{"error":"Validation failed","details":["Invalid cavity count"]}`

- [ ] **Step 3: Commit**

```bash
git add server/routes/orders.cjs
git commit -m "feat: add explicit Cavity validation rule to orderValidation"
```
