# Ceramic Tile EOD Order & Dispatch Management System

A production-grade End-of-Day (EOD) Order Tracking and Dispatch Management system built from the transcribed ceramic spreadsheet data. It includes data exports, a SQLite database with analytics views, a native Ruby REST API server, and a modern responsive web dashboard with truck load planning.

---

## 1. Project Structure

```
/Users/mac/Documents/EOD/
├── orders.csv            # Original transcribed spreadsheet in CSV format
├── orders.json           # Structured typed JSON dataset
├── schema.sql            # SQLite schema, indices, views, and initial seed
├── eod.db                # SQLite 3 database populated with initial orders
├── seed.rb               # Database initialization / reset script
├── server.rb             # Zero-dependency Ruby WEBrick REST API & static server
├── start.sh              # One-click startup script
├── public/
│   ├── index.html        # Interactive web dashboard
│   ├── style.css         # Modern industrial styling & print layout
│   └── app.js            # Reactive frontend logic, truck planner, CRUD
└── README.md             # Complete project documentation
```

---

## 2. Transcribed Spreadsheet Data Summary

| PLACE DATE | ORDER DAY | STATUS | MANAGE BY | CLIENT NAME | CITY | STATE | FACTORY | SIZE | PRODUCT | FINISH | GRADE | BOX QTY | WT/BOX | TOTAL WT | REMARK |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 25/08/26 | 21 | READY | BHURA BHAI | INDOTEK CERAMIC | KAKINADA | ANDHRA PRADESH | LEGEND | 16X16 | PARKING | - | PRM | 1,500 | 17.0 | 25,500 | - |
| 25/08/26 | 21 | NOT READY | BHURA BHAI | INDOTEK CERAMIC | Chibbrol | ANDHRA PRADESH | LEGEND | 16X16 | PARKING | - | PRM | 1,655 | 17.0 | 28,135 | - |
| 27/08/26 | 19 | READY | RINKU | ALLIED MARBLE & SANITARY | JAMBUSAR | GUJARAT | LEGEND | 16X16 | PARKING | - | PRM | 450 | 17.0 | 7,650 | - |
| 02/09/26 | 13 | READY | RINKU | ALLIED MARBLE & SANITARY | JAMBUSAR | GUJARAT | VEGANTO | 12X18 | WALL TILES | - | PRM | 4,010 | 10.5 | 42,105 | - |
| 05/09/26 | 10 | NOT READY | ATUL BHAI | INDOTEK CERAMIC | TUMKURU | KARNATAKA | ASTICA | 2X4 | CARVING GVT | CARVING | PRM | 920 | 26.5 | 24,380 | - |
| 12/09/26 | 3 | READY | RINKU | THAKUR JI TRADERS | KHAGARIA | BIHAR | ISCON | 12X18 | WALL TILES | - | PRM | 590 | 9.8 | 5,786 | - |

**Key Operational Aggregates:**
- **Total Orders:** 6 orders (8,625 boxes | 133.56 MT)
- **Ready for Dispatch:** 4 orders (6,550 boxes | 81.04 MT = ~3.1 trucks)
- **Pending / Not Ready:** 2 orders (2,075 boxes | 52.52 MT)
- **Critical Aging (>14 days):** 3 orders pending since late August

---

## 3. How to Run the Application

### Option A: Start the Backend Server & Web App
Run the start script in terminal:
```bash
cd /Users/mac/Documents/EOD
./start.sh
```
Or directly with Ruby:
```bash
ruby server.rb
```
Then open your browser to **`http://localhost:4567`**.

### Option B: Standalone / Offline Mode
You can also directly open `public/index.html` in your browser (via `open public/index.html` or double clicking in Finder). The dashboard will automatically use the built-in dataset with `localStorage` persistence.

---

## 4. REST API Documentation

The server exposes the following RESTful endpoints on `http://localhost:4567`:

| Endpoint | Method | Query Parameters / Body | Description |
|---|---|---|---|
| `/api/orders` | `GET` | `status`, `manage_by`, `factory_name`, `search`, `sort_by`, `order` | Retrieve orders matching filters |
| `/api/orders/:id` | `GET` | None | Retrieve specific order details |
| `/api/orders` | `POST` | JSON order object | Create a new ceramic order |
| `/api/orders/:id` | `PUT` | JSON updated fields | Update existing order or toggle status |
| `/api/orders/:id` | `DELETE` | None | Delete an order |
| `/api/stats` | `GET` | None | Real-time KPI summary & analytics breakdowns |
| `/api/export/csv` | `GET` | None | Download formatted CSV file |

---

## 5. Key Features

1. **Interactive Aging Badges**: Automatically calculates elapsed days (`ORDER DAY`) from booking date to current date with visual alerts (Critical >14d, Warning 7-14d, Normal <7d).
2. **Instant Status Toggling**: One-click toggling between `READY` and `NOT READY` directly on the table.
3. **Truck Load Consolidation Planner**: Check multiple orders to calculate consolidated weight and visualize truck capacity against standard 26 MT freight capacity.
4. **Order Management**: Create, edit, and delete orders with automatic calculation of total weight (`box_qty * box_weight`).
5. **Print-Ready EOD Report**: Clean print stylesheet for instant generation of dispatch daily reports.
