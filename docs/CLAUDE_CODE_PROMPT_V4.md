# Die Ordering System v4.0 - Complete Workflow Redesign

## Project Overview

Build a comprehensive **Die Ordering Management System** for Gulf Extrusions that covers the complete workflow from **Die Request** to **Die Receivance**. This system integrates the Design Team and Purchase Team into a unified platform with role-based access, real-time notifications, and seamless handoffs between departments.

## Key Stakeholders & Roles

| Role | Department | Primary Responsibilities |
|------|------------|-------------------------|
| **Design Engineer** | Design Team | Request dies, upload/approve designs, manage simulations |
| **Design Manager** | Design Team | Approve designs, monitor team workload, view analytics |
| **Purchase Officer** | Purchase Team | Create PRs, manage POs, track supplier deliveries, update ETA |
| **Purchase Manager** | Purchase Team | Approve PRs/POs, supplier management, cost tracking |
| **Admin** | IT/Management | User management, system configuration, full access |

---

## Complete Die Order Workflow (Stages)

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           DIE ORDER LIFECYCLE                                        │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   DIE        │───>│   DESIGN     │───>│   DESIGN     │───>│  SIMULATION  │       │
│  │   REQUEST    │    │   RECEIVED   │    │   APPROVAL   │    │  (Optional)  │       │
│  └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘       │
│        │                                                            │                │
│        │ Design Team                                                │                │
│        ▼                                                            ▼                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   DESIGN     │<───│   PR         │<───│   ORACLE     │<───│   PR         │       │
│  │   TO EMS     │    │   CREATION   │    │   ENTRY      │    │   APPROVAL   │       │
│  └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘       │
│        │                                                                             │
│        │ Handoff to Purchase Team                                                    │
│        ▼                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   PENDING    │───>│   PO         │───>│   PO         │───>│   SUPPLIER   │       │
│  │   ORDERING   │    │   CREATION   │    │   SENT       │    │   CONFIRMED  │       │
│  └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘       │
│        │                                                            │                │
│        │ Purchase Team                                              │                │
│        ▼                                                            ▼                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   IN         │───>│   SHIPPED    │───>│   IN         │───>│   DIE        │       │
│  │   PRODUCTION │    │              │    │   TRANSIT    │    │   RECEIVED   │       │
│  └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘       │
│                                                                      │               │
│                                                                      ▼               │
│                                                               ┌──────────────┐       │
│                                                               │   DONE /     │       │
│                                                               │   CANCELLED  │       │
│                                                               └──────────────┘       │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema (PostgreSQL)

### Enhanced Tables

```sql
-- Users table (enhanced with department)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user', -- admin, design_manager, design_engineer, purchase_manager, purchase_officer
    department TEXT, -- 'design', 'purchase', 'management'
    password_must_change BOOLEAN DEFAULT true,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP,
    notification_preferences JSONB DEFAULT '{"email": true, "inApp": true}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Die Orders table (enhanced with purchase fields)
CREATE TABLE die_orders (
    id SERIAL PRIMARY KEY,
    
    -- Basic Info
    plant TEXT NOT NULL,
    order_no TEXT,
    die_no TEXT NOT NULL,
    type TEXT, -- N=New, B=Backup, T=Tooling, C=Cancelled, H=Hold
    die_size TEXT,
    cavity INTEGER DEFAULT 1,
    mandrels_per_cavity INTEGER DEFAULT 0,
    total_mandrels INTEGER DEFAULT 0,
    
    -- Request Info
    die_requested_date DATE,
    requested_by INTEGER REFERENCES users(id),
    customer_name TEXT,
    urgency TEXT DEFAULT 'NORMAL', -- NORMAL, URGENT, TOP URGENT
    
    -- Design Phase
    design_received_date DATE,
    design_file_path TEXT,
    three_d_model_received_date DATE,
    three_d_model_path TEXT,
    simulation_enabled BOOLEAN DEFAULT false,
    simulation_status TEXT, -- PENDING, IN_PROGRESS, COMPLETED, FAILED
    simulation_result TEXT,
    design_approved_date DATE,
    design_approved_by INTEGER REFERENCES users(id),
    design_remarks TEXT,
    
    -- PR Phase (Design Team initiates)
    pr_entry_date DATE,
    pr_number TEXT,
    pr_approved_date DATE,
    pr_approved_by INTEGER REFERENCES users(id),
    oracle_entry_date DATE,
    oracle_requisition_no TEXT,
    
    -- PO Phase (Purchase Team)
    ordered_date DATE,
    po_number TEXT,
    po_line_number TEXT,
    po_created_by INTEGER REFERENCES users(id),
    po_approved_date DATE,
    po_approved_by INTEGER REFERENCES users(id),
    po_sent_date DATE,
    supplier_id INTEGER REFERENCES suppliers(id),
    shipment_type TEXT DEFAULT 'LAND', -- AIR, LAND
    
    -- Supplier & Delivery
    supplier_confirmed_date DATE,
    supplier_reference TEXT,
    production_start_date DATE,
    promised_delivery_date DATE,
    shipped_date DATE,
    shipping_reference TEXT, -- AWB/BL number
    eta_dubai DATE,
    actual_delivery_date DATE,
    received_by INTEGER REFERENCES users(id),
    
    -- Tracking
    status TEXT NOT NULL DEFAULT 'AWAITING FOR DESIGN',
    delay_days INTEGER DEFAULT 0,
    overall_delay INTEGER DEFAULT 0,
    month TEXT,
    remarks TEXT,
    
    -- Audit
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Suppliers table (enhanced)
CREATE TABLE suppliers (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    code TEXT UNIQUE,
    country TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    lead_time_air INTEGER DEFAULT 14, -- days
    lead_time_land INTEGER DEFAULT 21, -- days
    rating DECIMAL(3,2), -- 0.00 to 5.00
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Plants table
CREATE TABLE plants (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    code TEXT UNIQUE,
    location TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Status History (Audit Trail)
CREATE TABLE status_history (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES die_orders(id) ON DELETE CASCADE,
    old_status TEXT,
    new_status TEXT NOT NULL,
    changed_by INTEGER REFERENCES users(id),
    change_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notifications
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    order_id INTEGER REFERENCES die_orders(id) ON DELETE CASCADE,
    type TEXT NOT NULL, -- STATUS_CHANGE, APPROVAL_REQUIRED, ETA_UPDATE, DELAY_ALERT
    title TEXT NOT NULL,
    message TEXT,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- File Attachments
CREATE TABLE attachments (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES die_orders(id) ON DELETE CASCADE,
    file_type TEXT NOT NULL, -- DESIGN_PDF, 3D_MODEL, PI_DOCUMENT, PO_DOCUMENT, INVOICE, OTHER
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    uploaded_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Comments/Notes
CREATE TABLE comments (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES die_orders(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    comment_text TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT false, -- Internal notes not visible to all
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## Status Definitions

| Status | Stage | Responsible | Description |
|--------|-------|-------------|-------------|
| `AWAITING FOR DESIGN` | Design | Design Team | Die requested, waiting for supplier design |
| `PENDING FOR DESIGN APPROVAL` | Design | Design Manager | Design received, needs approval |
| `UNDER SIMULATION` | Design | Design Team | 3D model being simulated (optional) |
| `PENDING FOR DESIGN TO EMS` | Design | Design Team | Design approved, upload to EMS folder |
| `PENDING FOR PR` | Design | Design Team | Ready for PR creation |
| `PENDING FOR PR APPROVAL` | Design | Design Manager | PR created, needs manager approval |
| `PENDING FOR ORACLE ENTRY` | Design | Design Team | PR approved, enter in Oracle |
| `PENDING FOR ORDERING` | Handoff | Purchase Team | Ready for PO creation |
| `PO CREATED` | Purchase | Purchase Team | PO created, pending approval |
| `PO APPROVED` | Purchase | Purchase Manager | PO approved |
| `PO SENT TO SUPPLIER` | Purchase | Purchase Team | PO sent to supplier |
| `SUPPLIER CONFIRMED` | Purchase | Purchase Team | Supplier acknowledged order |
| `IN PRODUCTION` | Purchase | Purchase Team | Die being manufactured |
| `SHIPPED` | Purchase | Purchase Team | Die shipped from supplier |
| `IN TRANSIT` | Purchase | Purchase Team | En route to Dubai |
| `DELIVERED` | Purchase | Purchase Team | Received at GEX |
| `DONE` | Complete | - | Order completed |
| `CANCELLED` | Terminal | - | Order cancelled |
| `HOLD` | Paused | - | Order on hold |

---

## Tech Stack

### Frontend
- **React 18** with Hooks
- **Vite** for build tooling
- **Recharts** for analytics/charts
- **Lucide React** for icons
- **PDF.js** for PDF parsing (existing implementation)
- **XLSX** for Excel import/export
- **React Router** for navigation

### Backend
- **Node.js + Express.js**
- **PostgreSQL 15** database
- **JWT** authentication
- **bcrypt** for password hashing
- **express-validator** for input validation

### Deployment
- **Docker + Docker Compose**
- **Nginx** reverse proxy

---

## Key Features to Implement

### 1. Role-Based Dashboard Views

**Design Team Dashboard:**
- Orders awaiting design
- Orders pending approval (for managers)
- Simulation queue
- My pending tasks
- Design KPIs (turnaround time, approval rate)

**Purchase Team Dashboard:**
- Orders ready for PO
- POs pending approval
- Orders with suppliers
- Delivery tracking
- ETA calendar view
- Purchase KPIs (lead times, supplier performance)

### 2. Enhanced Order Management

**Design Team Actions:**
- Create die request
- Upload design PDF (with parsing from existing `PDFImportModal`)
- Mark design received
- Request/view simulation results
- Approve design (managers)
- Create PR
- Enter Oracle requisition

**Purchase Team Actions:**
- Import PI documents (existing `PIImportModal` - KEEP THIS!)
- Create/edit PO details
- Send PO to supplier
- Update supplier confirmation
- Update production status
- Update shipping info (AWB/BL)
- Update ETA
- Mark as received

### 3. PDF Import Features (PRESERVE EXISTING)

**CRITICAL: Keep the existing PDF import implementations:**

**PIImportModal.jsx** - Import from Purchase Instruction documents:
- Parses PI PDFs from purchase team
- Extracts: PR number, supplier, shipment type, order date
- Extracts die details from table rows
- Maps press codes to plants (AUH→GEX 2, DXB→GEX 1)
- Scans drawing pages for requested dates
- Handles multiple dies per PI document

**PDFImportModal** - Import from Die Drawing PDFs:
- Position-based text extraction from die drawing info box
- Extracts: supplier, die size, cavity, press/plant, shipment type
- Detects urgency from filename
- Supports batch multi-file upload

### 4. Notification System

**Trigger Notifications:**
- Status changes → Notify relevant team
- Approval required → Notify approvers
- ETA updates → Notify design team
- Delays detected → Notify managers
- Delivery received → Notify requestor

### 5. Analytics & Reports

**Design Analytics:**
- Design turnaround time by supplier
- Approval rate trends
- Simulation success rate
- Delay analysis

**Purchase Analytics:**
- Supplier lead time performance
- On-time delivery rate
- Cost analysis by supplier
- Orders by shipment type

### 6. Search & Filters

- Global search (die no, PO, PR, order no)
- Filter by status, plant, supplier, date range
- Filter by assigned to (my orders)
- Save filter presets

---

## API Endpoints

### Authentication
```
POST   /api/auth/login
POST   /api/auth/logout
POST   /api/auth/change-password
GET    /api/auth/me
```

### Orders
```
GET    /api/orders                    # List all (with filters)
GET    /api/orders/:id                # Get single order
POST   /api/orders                    # Create order
PUT    /api/orders/:id                # Update order
DELETE /api/orders/:id                # Delete order
POST   /api/orders/import             # Bulk import
GET    /api/orders/:id/history        # Status history
POST   /api/orders/:id/comments       # Add comment
GET    /api/orders/:id/attachments    # List attachments
POST   /api/orders/:id/attachments    # Upload attachment
```

### Purchase-Specific
```
POST   /api/orders/:id/create-po      # Create PO for order
PUT    /api/orders/:id/update-eta     # Update ETA
PUT    /api/orders/:id/mark-shipped   # Mark as shipped
PUT    /api/orders/:id/mark-received  # Mark as received
```

### Suppliers
```
GET    /api/suppliers
POST   /api/suppliers
PUT    /api/suppliers/:id
DELETE /api/suppliers/:id
GET    /api/suppliers/:id/performance # Supplier metrics
```

### Users
```
GET    /api/users
POST   /api/users
PUT    /api/users/:id
DELETE /api/users/:id
```

### Notifications
```
GET    /api/notifications             # My notifications
PUT    /api/notifications/:id/read    # Mark as read
PUT    /api/notifications/read-all    # Mark all as read
```

### Analytics
```
GET    /api/analytics/design          # Design team metrics
GET    /api/analytics/purchase        # Purchase team metrics
GET    /api/analytics/suppliers       # Supplier performance
```

---

## UI Components Structure

```
src/
├── components/
│   ├── layout/
│   │   ├── Sidebar.jsx              # Role-based navigation
│   │   ├── TopBar.jsx               # Search, notifications, user menu
│   │   └── MainLayout.jsx           # Page wrapper
│   ├── dashboard/
│   │   ├── DesignDashboard.jsx      # Design team view
│   │   ├── PurchaseDashboard.jsx    # Purchase team view
│   │   ├── AdminDashboard.jsx       # Admin overview
│   │   └── widgets/                 # Dashboard cards/widgets
│   ├── orders/
│   │   ├── OrderList.jsx            # Table view with filters
│   │   ├── OrderDetail.jsx          # Full order view
│   │   ├── OrderForm.jsx            # Create/Edit form
│   │   ├── OrderTimeline.jsx        # Status history timeline
│   │   ├── OrderKanban.jsx          # Kanban board view
│   │   └── OrderCalendar.jsx        # ETA calendar view
│   ├── modals/
│   │   ├── PIImportModal.jsx        # ★ KEEP EXISTING - PI document import
│   │   ├── PDFImportModal.jsx       # ★ KEEP EXISTING - Drawing PDF import
│   │   ├── POCreateModal.jsx        # NEW - Create PO
│   │   ├── ETAUpdateModal.jsx       # NEW - Update delivery info
│   │   ├── ApprovalModal.jsx        # NEW - Approval workflow
│   │   └── CommentModal.jsx         # NEW - Add comments
│   ├── analytics/
│   │   ├── DesignAnalytics.jsx
│   │   ├── PurchaseAnalytics.jsx
│   │   └── SupplierAnalytics.jsx
│   ├── notifications/
│   │   ├── NotificationBell.jsx
│   │   └── NotificationList.jsx
│   └── common/
│       ├── StatusBadge.jsx
│       ├── ProgressPipeline.jsx
│       ├── DataTable.jsx
│       ├── FilterPanel.jsx
│       └── FileUpload.jsx
├── context/
│   ├── AuthContext.jsx
│   └── NotificationContext.jsx
├── hooks/
│   ├── useOrders.js
│   ├── useNotifications.js
│   └── useAnalytics.js
├── services/
│   └── api.js
├── utils/
│   ├── constants.js
│   ├── helpers.js
│   └── pdfParsers.js               # PDF parsing utilities
└── pages/
    ├── Login.jsx
    ├── Dashboard.jsx
    ├── Orders.jsx
    ├── OrderDetail.jsx
    ├── Suppliers.jsx
    ├── Users.jsx
    ├── Analytics.jsx
    └── Settings.jsx
```

---

## Implementation Priority

### Phase 1: Foundation (Week 1)
1. Database schema migration
2. Enhanced user roles & authentication
3. Basic order CRUD with new fields
4. Role-based routing

### Phase 2: Design Team Features (Week 2)
1. Design team dashboard
2. Design workflow (request → approval)
3. Keep existing PDF import modals working
4. PR/Oracle entry workflow

### Phase 3: Purchase Team Features (Week 3)
1. Purchase team dashboard
2. PO creation workflow
3. ETA tracking
4. Delivery management
5. PI import integration (existing PIImportModal)

### Phase 4: Integration & Polish (Week 4)
1. Notification system
2. Analytics dashboards
3. Search & filters
4. Testing & bug fixes

---

## Important Notes for Claude Code

### PRESERVE THESE FILES (Critical Implementations):
1. **`src/components/modals/PIImportModal.jsx`** - Complex PI document parsing with:
   - PDF.js position-based text extraction
   - Y-position grouping for table row reconstruction
   - Press code to plant mapping
   - Multi-page drawing scanning for dates
   - Shipment type detection

2. **PDFImportModal** (inline in DieOrderingSystem.jsx) - Die drawing parsing with:
   - Info box field extraction
   - Batch multi-file upload
   - Filename metadata extraction

### REFERENCE THESE FOR PATTERNS:
- `server/routes/orders.cjs` - API validation patterns
- `src/api.js` - Frontend API client pattern
- `init.sql` - Database initialization pattern
- `docker-compose.yml` - Deployment configuration

### TECH DECISIONS:
- Use PostgreSQL (not SQLite) - already configured
- Use JWT authentication - already implemented
- Use bcrypt for passwords - already implemented
- Keep the existing dark theme UI style
- Maintain mobile-responsive design

### TESTING DATA:
- Test PI PDFs available in `TestData/` folder
- Use existing sample data patterns from `INITIAL_SAMPLE_DATA`

---

## Getting Started Command

```bash
# Start development
cd D:\Projects\v3.0\die-ordering-app
npm install
npm run dev          # Frontend on :5173
npm run server:dev   # Backend on :3001

# Or use Docker
docker compose up -d
```

---

## Success Criteria

1. ✅ Design team can manage orders from request to PR approval
2. ✅ Purchase team can create POs and track deliveries
3. ✅ Both teams see relevant dashboards
4. ✅ Existing PDF import features work unchanged
5. ✅ Notifications alert users of required actions
6. ✅ Full audit trail of status changes
7. ✅ Analytics show team performance metrics
8. ✅ Mobile-responsive for warehouse receiving

---

*This prompt provides comprehensive context for Claude Code to build the complete Die Ordering System v4.0 with integrated Purchase Team workflow.*
