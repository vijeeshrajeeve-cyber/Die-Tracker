# Quick Start Prompt for Claude Code

Copy and paste this prompt when starting a new Claude Code session:

---

## Prompt:

I need to redesign my Die Ordering web application to include the Purchase Team workflow. The app currently handles the Design Team's workflow (die request → design approval → PR creation). Now I need to extend it to cover the complete lifecycle including Purchase Team actions (PO creation → supplier tracking → delivery).

**Current Project Location:** `D:\Projects\v3.0\die-ordering-app`

**Please read these files first to understand the existing implementation:**

1. `docs/CLAUDE_CODE_PROMPT_V4.md` - Full requirements and database schema
2. `src/components/modals/PIImportModal.jsx` - **CRITICAL: Keep this working** - Complex PI document parsing
3. `src/DieOrderingSystem.jsx` - Main app component (first 200 lines for structure)
4. `server/routes/orders.cjs` - Current API patterns
5. `init.sql` - Current database schema

**Key Requirements:**

1. **Role-Based Access:**
   - Design Team roles: `design_engineer`, `design_manager`
   - Purchase Team roles: `purchase_officer`, `purchase_manager`
   - Each sees different dashboard and actions

2. **Extended Status Flow:**
   ```
   Design Phase: AWAITING FOR DESIGN → DESIGN APPROVAL → SIMULATION → PR → ORACLE
   Purchase Phase: PENDING FOR ORDERING → PO CREATED → PO SENT → SUPPLIER CONFIRMED → IN PRODUCTION → SHIPPED → DELIVERED → DONE
   ```

3. **New Purchase Team Features:**
   - PO creation and tracking
   - Supplier confirmation
   - ETA management
   - Shipping tracking (AWB/BL numbers)
   - Delivery recording

4. **PRESERVE EXISTING:**
   - PIImportModal.jsx - Don't break the PI document import
   - PDF drawing import functionality
   - Dark theme UI style
   - Docker deployment setup

5. **New Database Fields Needed:**
   - `po_number`, `po_line_number`, `po_created_by`, `po_approved_date`
   - `supplier_confirmed_date`, `production_start_date`
   - `shipped_date`, `shipping_reference`, `eta_dubai`, `actual_delivery_date`
   - User `department` field ('design' or 'purchase')

**Tech Stack:** React + Vite, Express.js, PostgreSQL, Docker

**Start by:**
1. Creating a migration plan for the database changes
2. Extending the user roles system
3. Building the Purchase Team dashboard
4. Adding PO management features

Let's begin with the database migration first.

---

## Alternative Shorter Prompt:

---

Read `D:\Projects\v3.0\die-ordering-app\docs\CLAUDE_CODE_PROMPT_V4.md` for full requirements.

I need to extend my Die Ordering app to include Purchase Team workflow. Currently it handles Design Team only (die request → design approval → PR). Need to add:

1. Purchase Team roles & dashboard
2. PO creation/tracking
3. Supplier confirmation & ETA management  
4. Shipping & delivery tracking
5. Extended status flow through delivery

**CRITICAL:** Don't break existing `PIImportModal.jsx` - it has complex PDF parsing logic.

Start with database schema migration, then build incrementally.

---
