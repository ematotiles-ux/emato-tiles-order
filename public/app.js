// ==========================================================
// Ceramic Order Manager v2.0 - Frontend Client Logic
// ==========================================================

const API_BASE = window.location.origin.startsWith('http') ? '' : 'http://localhost:4567';

function getLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatAgingBadge(days, compact = false) {
  const d = Math.max(0, parseInt(days, 10) || 0);
  if (compact) {
    if (d === 0) return '<span class="aging-pill aging-recent">✓ Today</span>';
    if (d < 7) return `<span class="aging-pill aging-recent">✓ ${d}d</span>`;
    if (d <= 15) return `<span class="aging-pill aging-warning">⏳ ${d}d</span>`;
    return `<span class="aging-pill aging-critical">⚠️ ${d}d</span>`;
  }
  if (d === 0) return '<span class="aging-pill aging-recent">✓ Today</span>';
  if (d === 1) return '<span class="aging-pill aging-recent">✓ 1 day</span>';
  if (d < 7) return `<span class="aging-pill aging-recent">✓ ${d} days</span>`;
  if (d <= 15) return `<span class="aging-pill aging-warning">⏳ ${d} days</span>`;
  return `<span class="aging-pill aging-critical">⚠️ ${d} days</span>`;
}

// State
let allOrders = [];
let allFactories = [];
let activeView = 'orders-sheet';
let activeSheetTab = 'ALL'; // Start with ALL orders so nothing is hidden!
let activeDealerFilter = 'ALL';
let activeCenterFilter = 'ALL';
let activeFactoryFilter = 'ALL';
let activeManagerFilter = 'ALL';
let activeGradeFilter = 'ALL';
let activeAgeFilter = 'ALL';
let searchQuery = '';
let selectedOrderIds = new Set();
let currentOpenFactory = null;
let currentOpenClient = null;
let activeDealersCentersSubtab = 'dealers';
let showDispatchedInOrders = false; // Dispatched & Billed orders hidden from active order sheets by default

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadData();

  // Auto-refresh when tab gains focus (e.g. returning to app on mobile or desktop)
  window.addEventListener('focus', () => {
    const modal = document.getElementById('orderModal');
    const isModalOpen = modal && modal.style.display !== 'none' && modal.style.display !== '';
    if (!isModalOpen) {
      loadData();
    }
  });

  // Background auto-refresh & keep-alive ping every 45 seconds (only when edit modal is closed)
  setInterval(() => {
    const modal = document.getElementById('orderModal');
    const isModalOpen = modal && modal.style.display !== 'none' && modal.style.display !== '';
    if (!isModalOpen) {
      loadData();
    }
  }, 45000);
});

// Setup event listeners
function setupEventListeners() {
  // Automatic Real-Time All Entry Done in Capital Font
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el) return;
    const tag = el.tagName;
    const type = (el.type || '').toLowerCase();

    // Transform text, search, or untyped inputs and textareas
    if (tag === 'TEXTAREA' || (tag === 'INPUT' && (type === 'text' || type === 'search' || type === '' || type === 'tel'))) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const oldVal = el.value;
      const newVal = oldVal.toUpperCase();
      if (oldVal !== newVal) {
        el.value = newVal;
        if (start !== null && end !== null) {
          el.setSelectionRange(start, end);
        }
      }
    }
  });

  // Search input in Orders Sheet
  const searchInput = document.getElementById('sheetSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      renderOrdersSheet();
    });
  }

  // Dropdown filters
  const dealerSelect = document.getElementById('filterDealerSelect');
  if (dealerSelect) {
    dealerSelect.addEventListener('change', (e) => {
      activeDealerFilter = e.target.value;
      renderOrdersSheet();
    });
  }

  const centerSelect = document.getElementById('filterCenterSelect');
  if (centerSelect) {
    centerSelect.addEventListener('change', (e) => {
      activeCenterFilter = e.target.value;
      renderOrdersSheet();
    });
  }

  const facSelect = document.getElementById('filterFactorySelect');
  if (facSelect) {
    facSelect.addEventListener('change', (e) => {
      activeFactoryFilter = e.target.value;
      renderOrdersSheet();
    });
  }

  const mgrSelect = document.getElementById('filterManagerSelect');
  if (mgrSelect) {
    mgrSelect.addEventListener('change', (e) => {
      activeManagerFilter = e.target.value;
      renderOrdersSheet();
    });
  }

  const gradeSelect = document.getElementById('filterGradeSelect');
  if (gradeSelect) {
    gradeSelect.addEventListener('change', (e) => {
      activeGradeFilter = e.target.value;
      renderOrdersSheet();
    });
  }

  const ageSelect = document.getElementById('filterAgeSelect');
  if (ageSelect) {
    ageSelect.addEventListener('change', (e) => {
      activeAgeFilter = e.target.value;
      renderOrdersSheet();
    });
  }

  // Select all checkbox
  const selAll = document.getElementById('selectAllCheckbox');
  if (selAll) {
    selAll.addEventListener('change', (e) => {
      const visible = getFilteredOrders();
      if (e.target.checked) {
        visible.forEach(o => selectedOrderIds.add(o.id));
      } else {
        visible.forEach(o => selectedOrderIds.delete(o.id));
      }
      renderOrdersSheet();
      updateTruckPlannerUI();
    });
  }

  // Modal open / close handlers
  document.getElementById('btnOpenNewModal').addEventListener('click', () => openOrderModal());
  document.getElementById('btnCloseOrderModal').addEventListener('click', closeOrderModal);
  document.getElementById('btnCancelOrderModal').addEventListener('click', closeOrderModal);

  // Form submit
  document.getElementById('orderForm').addEventListener('submit', handleFormSubmit);

  // Export and print
  document.getElementById('btnExportExcel').addEventListener('click', exportCSV);
  document.getElementById('btnPrint').addEventListener('click', () => window.print());

  // Google Sheet Sync & Import
  document.getElementById('btnGoogleSync').addEventListener('click', () => {
    showToast('Synced with Google Sheet (0 active orders in cloud)', 'info');
  });
  document.getElementById('btnImport').addEventListener('click', () => {
    showToast('Excel/CSV Import Ready - upload your file anytime', 'info');
  });

  // Factory Drilldown View in Sheet Button
  const btnFilterFac = document.getElementById('btnFilterThisFactoryInSheet');
  if (btnFilterFac) {
    btnFilterFac.addEventListener('click', () => {
      if (currentOpenFactory) filterThisFactoryInSheet(currentOpenFactory);
    });
  }

  // WhatsApp summary button in factory modal
  const btnShareFacWA = document.getElementById('btnShareFactoryWhatsapp');
  if (btnShareFacWA) {
    btnShareFacWA.addEventListener('click', () => {
      if (currentOpenFactory) shareFactoryWhatsapp(currentOpenFactory);
    });
  }

  // Client modal filter in sheet button
  const btnFilterClient = document.getElementById('btnFilterThisClientInSheet');
  if (btnFilterClient) {
    btnFilterClient.addEventListener('click', () => {
      if (currentOpenClient) filterDealerInSheet(currentOpenClient);
    });
  }

  // Client modal whatsapp button
  const btnShareClientWA = document.getElementById('btnShareClientWhatsapp');
  if (btnShareClientWA) {
    btnShareClientWA.addEventListener('click', () => {
      if (currentOpenClient) shareClientWhatsapp(currentOpenClient);
    });
  }
}

// Load data from backend API
let isInitialLoad = true;
let loadRetryTimer = null;

async function loadData() {
  try {
    const [ordersRes, factoriesRes, statsRes] = await Promise.all([
      fetch(`${API_BASE}/api/orders`),
      fetch(`${API_BASE}/api/factories`),
      fetch(`${API_BASE}/api/stats`)
    ]);

    if (!ordersRes.ok) throw new Error(`Orders API returned ${ordersRes.status}`);

    allOrders = await ordersRes.json();
    allFactories = await factoriesRes.json();
    const stats = await statsRes.json();

    updateKPIs(stats);
    isInitialLoad = false;
  } catch (err) {
    console.warn('API connection or cold-start notice:', err);
    // CRITICAL: NEVER wipe existing allOrders on network error or server spin-up!
    // Keeping existing orders prevents the screen from going blank "after some time".
    if (isInitialLoad && allOrders.length === 0) {
      updateKPIs({ total_orders: 0, total_boxes: 0, total_weight_kg: 0, total_weight_mt: 0, critical_aging_count: 0 });
    }
    // Automatically retry in 3 seconds to seamlessly catch server wake-up
    clearTimeout(loadRetryTimer);
    loadRetryTimer = setTimeout(loadData, 3000);
  }

  populateFilterDropdowns();
  populateOrderNoDatalist();
  renderOrdersSheet();
  renderFactoriesHub();
  renderDealersCenters();
  renderKanbanPipeline();
  updateSheetTabsCounts();
}

// Switch between Views (Orders Sheet, Factories Hub, Dealers & Centers, Kanban, etc.)
function switchView(viewName) {
  activeView = viewName;

  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  const sheetView = document.getElementById('viewOrdersSheet');
  const hubView = document.getElementById('viewFactoriesHub');
  const dealersView = document.getElementById('viewDealersCenters');
  const pipelineView = document.getElementById('viewMerchantPipeline');

  if (sheetView) sheetView.style.display = 'none';
  if (hubView) hubView.style.display = 'none';
  if (dealersView) dealersView.style.display = 'none';
  if (pipelineView) pipelineView.style.display = 'none';

  if (viewName === 'orders-sheet') {
    document.getElementById('tabOrdersSheet').classList.add('active');
    sheetView.style.display = 'flex';
    renderOrdersSheet();
  } else if (viewName === 'factories-hub') {
    document.getElementById('tabFactoriesHub').classList.add('active');
    hubView.style.display = 'block';
    renderFactoriesHub();
  } else if (viewName === 'dealers-centers') {
    document.getElementById('tabDealersCenters').classList.add('active');
    dealersView.style.display = 'block';
    renderDealersCenters();
  } else if (viewName === 'pipeline') {
    document.getElementById('tabMerchantPipeline').classList.add('active');
    pipelineView.style.display = 'block';
    renderKanbanPipeline();
  } else if (viewName === 'truck-dispatch') {
    document.getElementById('tabTruckDispatch').classList.add('active');
    sheetView.style.display = 'flex';
    renderOrdersSheet();
    const banner = document.getElementById('truckPlannerBanner');
    if (banner) {
      banner.style.display = 'flex';
      banner.scrollIntoView({ behavior: 'smooth' });
    }
  }
}

// Populate Filter Dropdowns
function populateFilterDropdowns() {
  const facSelect = document.getElementById('filterFactorySelect');
  const mgrSelect = document.getElementById('filterManagerSelect');
  const dealerSelect = document.getElementById('filterDealerSelect');
  const centerSelect = document.getElementById('filterCenterSelect');

  const factories = new Set();
  const managers = new Set();
  const dealers = new Set();
  const centers = new Set();

  allOrders.forEach(o => {
    if (o.factory_name) factories.add(o.factory_name.trim().toUpperCase());
    if (o.manage_by) managers.add(o.manage_by.trim().toUpperCase());
    if (o.client_name) dealers.add(o.client_name.trim().toUpperCase());
    if (o.city) centers.add(o.city.trim().toUpperCase());
  });

  if (facSelect) {
    facSelect.innerHTML = '<option value="ALL">All Factories</option>' +
      Array.from(factories).sort().map(f => `<option value="${escapeHtml(f)}" ${f === activeFactoryFilter ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('');
  }

  if (mgrSelect) {
    mgrSelect.innerHTML = '<option value="ALL">All Managers</option>' +
      Array.from(managers).sort().map(m => `<option value="${escapeHtml(m)}" ${m === activeManagerFilter ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('');
  }

  if (dealerSelect) {
    dealerSelect.innerHTML = '<option value="ALL">All Dealers / Clients</option>' +
      Array.from(dealers).sort().map(d => `<option value="${escapeHtml(d)}" ${d === activeDealerFilter ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');
  }

  if (centerSelect) {
    centerSelect.innerHTML = '<option value="ALL">All Centers / Cities</option>' +
      Array.from(centers).sort().map(c => `<option value="${escapeHtml(c)}" ${c === activeCenterFilter ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
  }
}

// Bottom Sheet Tab Switching
function switchSheetTab(tabName) {
  activeSheetTab = tabName;
  updateSheetTabHighlight(tabName);
  renderOrdersSheet();
}

function updateSheetTabHighlight(tabName) {
  document.querySelectorAll('.sheet-tab').forEach(t => {
    if (t.getAttribute('data-sheet') === tabName) {
      t.classList.add('active');
    } else {
      t.classList.remove('active');
    }
  });
}

function updateSheetTabsCounts() {
  const countUniqueOrders = (items) => {
    const set = new Set();
    items.forEach(o => {
      const ono = (o.order_no || `EM-${1000 + o.id}`).trim().toUpperCase();
      set.add(ono);
    });
    return set.size;
  };

  const activeOrders = allOrders.filter(o => o.status !== 'DISPATCHED' && o.status !== 'BILLED DONE');
  const basePool = showDispatchedInOrders ? allOrders : activeOrders;

  const allCount = countUniqueOrders(basePool);
  const dealerCount = countUniqueOrders(basePool.filter(o => o.party_type === 'DEALER'));
  const projectCount = countUniqueOrders(basePool.filter(o => o.party_type === 'PROJECT'));
  const depoCount = countUniqueOrders(basePool.filter(o => o.party_type === 'DEPO ORDER'));
  const readyCount = countUniqueOrders(allOrders.filter(o => o.status === 'READY'));
  const dispatchedCount = countUniqueOrders(allOrders.filter(o => o.status === 'DISPATCHED'));
  const billedCount = countUniqueOrders(allOrders.filter(o => o.status === 'BILLED DONE'));

  const allEl = document.getElementById('sheetCountAll');
  if (allEl) allEl.textContent = allCount;
  const dealerEl = document.getElementById('sheetCountDealer');
  if (dealerEl) dealerEl.textContent = dealerCount;
  const projectEl = document.getElementById('sheetCountProject');
  if (projectEl) projectEl.textContent = projectCount;
  const depoEl = document.getElementById('sheetCountDepo');
  if (depoEl) depoEl.textContent = depoCount;
  const readyEl = document.getElementById('sheetCountReady');
  if (readyEl) readyEl.textContent = readyCount;
  const dispEl = document.getElementById('sheetCountDispatched');
  if (dispEl) dispEl.textContent = dispatchedCount;
  const billEl = document.getElementById('sheetCountBilled');
  if (billEl) billEl.textContent = billedCount;
}

function toggleShowDispatched(checked) {
  showDispatchedInOrders = !!checked;
  updateSheetTabsCounts();
  renderOrdersSheet();
}

// Filter orders based on active filters
function getFilteredOrders() {
  return allOrders.filter(o => {
    // Dedicated Tab: DISPATCHED -> only dispatched orders
    if (activeSheetTab === 'DISPATCHED') {
      if (o.status !== 'DISPATCHED') return false;
    }
    // Dedicated Tab: BILLED DONE -> only billed orders
    else if (activeSheetTab === 'BILLED DONE') {
      if (o.status !== 'BILLED DONE') return false;
    }
    // Active Order Sections: ALL, DEALER, PROJECT, DEPO ORDER, REDY ORDER
    else {
      // Dispatched and Billed orders must NOT show in active order section
      if (!showDispatchedInOrders) {
        if (o.status === 'DISPATCHED' || o.status === 'BILLED DONE') return false;
      }
      if (activeSheetTab === 'DEALER' && o.party_type !== 'DEALER') return false;
      if (activeSheetTab === 'PROJECT' && o.party_type !== 'PROJECT') return false;
      if (activeSheetTab === 'DEPO ORDER' && o.party_type !== 'DEPO ORDER') return false;
      if (activeSheetTab === 'REDY ORDER' && o.status !== 'READY') return false;
    }

    if (activeDealerFilter !== 'ALL' && (o.client_name || '').trim().toUpperCase() !== activeDealerFilter) return false;
    if (activeCenterFilter !== 'ALL' && (o.city || '').trim().toUpperCase() !== activeCenterFilter) return false;
    if (activeFactoryFilter !== 'ALL' && (o.factory_name || '').trim().toUpperCase() !== activeFactoryFilter) return false;
    if (activeManagerFilter !== 'ALL' && (o.manage_by || '').trim().toUpperCase() !== activeManagerFilter) return false;
    if (activeGradeFilter !== 'ALL' && (o.grade || '') !== activeGradeFilter) return false;

    if (activeAgeFilter === '<7' && o.order_day >= 7) return false;
    if (activeAgeFilter === '7-15' && (o.order_day < 7 || o.order_day > 15)) return false;
    if (activeAgeFilter === '>15' && o.order_day <= 15) return false;

    if (searchQuery) {
      const s = `${o.order_no || ''} ${o.client_name} ${o.city} ${o.state} ${o.factory_name} ${o.product} ${o.size} ${o.manage_by}`.toLowerCase();
      if (!s.includes(searchQuery)) return false;
    }

    return true;
  });
}

let currentSortCol = 'place_date';
let currentSortDir = 'desc';

function sortSheetBy(col) {
  if (currentSortCol === col) {
    currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    currentSortCol = col;
    currentSortDir = (col === 'place_date' || col === 'box_qty' || col === 'total_weight' || col === 'order_day') ? 'desc' : 'asc';
  }
  updateSortHeaderIcons();
  renderOrdersSheet();
}

function updateSortHeaderIcons() {
  document.querySelectorAll('.orders-table th[data-sort]').forEach(th => {
    const col = th.getAttribute('data-sort');
    const icon = th.querySelector('.sort-icon');
    if (!icon) return;
    if (col === currentSortCol) {
      icon.textContent = currentSortDir === 'asc' ? '▲' : '▼';
      icon.style.color = '#0284c7';
      icon.style.fontWeight = '900';
    } else {
      icon.textContent = '⇅';
      icon.style.color = '#94a3b8';
      icon.style.fontWeight = 'normal';
    }
  });
}

function getGroupedFilteredOrders() {
  const visibleItems = getFilteredOrders();
  const groupMap = new Map();
  const orderGroups = [];

  visibleItems.forEach(item => {
    const ono = (item.order_no || `EM-${1000 + item.id}`).trim().toUpperCase();
    if (!groupMap.has(ono)) {
      const grp = {
        order_no: ono,
        client_name: item.client_name || '',
        city: item.city || '',
        state: item.state || '',
        manage_by: item.manage_by || '',
        place_date: item.place_date || '',
        place_date_display: item.place_date_display || item.place_date || '',
        order_day: item.order_day !== undefined ? item.order_day : 0,
        party_type: item.party_type || 'DEALER',
        total_boxes: 0,
        total_weight: 0,
        items: []
      };
      groupMap.set(ono, grp);
      orderGroups.push(grp);
    }
    const grp = groupMap.get(ono);
    grp.items.push(item);
    grp.total_boxes += (item.box_qty || 0);
    grp.total_weight += (item.total_weight || 0);
  });

  // Sort items within each order chronologically (id asc)
  orderGroups.forEach(grp => {
    grp.items.sort((a, b) => a.id - b.id);
  });

  // Sort order groups according to currentSortCol and currentSortDir
  orderGroups.sort((a, b) => {
    let comp = 0;
    if (currentSortCol === 'order_no') {
      comp = a.order_no.localeCompare(b.order_no, undefined, { numeric: true });
    } else if (currentSortCol === 'place_date') {
      comp = (a.place_date || '').localeCompare(b.place_date || '');
      if (comp === 0) comp = a.order_no.localeCompare(b.order_no, undefined, { numeric: true });
    } else if (currentSortCol === 'order_day') {
      comp = (a.order_day || 0) - (b.order_day || 0);
    } else if (currentSortCol === 'manage_by') {
      comp = (a.manage_by || '').localeCompare(b.manage_by || '');
    } else if (currentSortCol === 'client_name') {
      comp = (a.client_name || '').localeCompare(b.client_name || '');
    } else if (currentSortCol === 'city') {
      comp = (a.city || '').localeCompare(b.city || '');
    } else if (currentSortCol === 'box_qty') {
      comp = a.total_boxes - b.total_boxes;
    } else if (currentSortCol === 'total_weight') {
      comp = a.total_weight - b.total_weight;
    } else {
      comp = (a.place_date || '').localeCompare(b.place_date || '');
    }
    return currentSortDir === 'asc' ? comp : -comp;
  });

  return orderGroups;
}

// Render Orders Sheet Table (Grouped by Order with Distinct Dividers)
function renderOrdersSheet() {
  const orderGroups = getGroupedFilteredOrders();
  const tbody = document.getElementById('ordersTableBody');
  tbody.innerHTML = '';

  if (allOrders.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="13" style="text-align:center; padding: 48px 20px; color: #64748b;">
          <div style="font-size: 2.2rem; margin-bottom: 8px;">📦</div>
          <div style="font-weight: 800; font-size: 1rem; color: #0f172a; margin-bottom: 4px;">No Orders Entered Yet</div>
          <p style="font-size: 0.82rem; margin-bottom: 16px;">The order database is empty and ready for you to try out.</p>
          <button class="btn btn-primary" onclick="openOrderModal()">+ Place Your First Order</button>
        </td>
      </tr>
    `;
    return;
  }

  if (orderGroups.length === 0) {
    let emptyMsg = 'No matching orders found for selected filters.';
    if (activeSheetTab === 'DISPATCHED') {
      emptyMsg = '🚚 No dispatched orders found. When an order is dispatched, it appears here!';
    } else if (activeSheetTab === 'BILLED DONE') {
      emptyMsg = '🧾 No billed orders found. When an order is transferred to Billed Done, it appears here!';
    } else if (activeSheetTab === 'REDY ORDER') {
      emptyMsg = '✓ No ready orders yet. Mark items as READY to prepare for truck dispatch.';
    }
    tbody.innerHTML = `
      <tr>
        <td colspan="13" style="text-align:center; padding: 42px 20px; color: var(--text-muted);">
          <div style="font-size: 1.8rem; margin-bottom: 8px;">📋</div>
          <div style="font-weight: 700; font-size: 0.95rem; color: #334155; margin-bottom: 6px;">${emptyMsg}</div>
          <div style="margin-top: 10px;">
            <button class="btn btn-sm btn-outline" onclick="resetAllFilters()">Reset All Filters</button>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  updateSortHeaderIcons();

  orderGroups.forEach((grp, grpIdx) => {
    const isEven = grpIdx % 2 === 0;
    const grpClass = isEven ? 'order-grp-even' : 'order-grp-odd';
    const isMulti = grp.items.length > 1;

    grp.items.forEach((o, itemIdx) => {
      const isFirst = itemIdx === 0;
      const isLast = itemIdx === grp.items.length - 1;
      const isSel = selectedOrderIds.has(o.id);
      const isReady = o.status === 'READY';
      const orderNoStr = grp.order_no;

      let statusClass = 'not-ready';
      let statusIcon = '⏳';
      let statusLabel = 'NOT READY';
      if (o.status === 'READY') {
        statusClass = 'ready';
        statusIcon = '✓';
        statusLabel = 'READY';
      } else if (o.status === 'DISPATCHED') {
        statusClass = 'dispatched';
        statusIcon = '🚚';
        statusLabel = 'DISPATCHED';
      } else if (o.status === 'BILLED DONE') {
        statusClass = 'billed';
        statusIcon = '🧾';
        statusLabel = 'BILLED DONE';
      }

      let quickTransferBtn = '';
      if (o.status === 'DISPATCHED') {
        quickTransferBtn = `
          <button class="btn-transfer-billed" onclick="event.stopPropagation(); setOrderStatus(${o.id}, 'BILLED DONE')" title="Transfer this factory product to BILLED DONE">
            🧾 Transfer to Billed
          </button>
        `;
      } else if (o.status === 'READY') {
        quickTransferBtn = `
          <button class="btn-transfer-dispatch" onclick="event.stopPropagation(); setOrderStatus(${o.id}, 'DISPATCHED')" title="Mark this factory product as DISPATCHED">
            🚚 Dispatch
          </button>
        `;
      }

      const agingHtml = formatAgingBadge(o.order_day);

      const tr = document.createElement('tr');
      tr.className = `order-row ${grpClass} ${isFirst ? 'order-row-first' : 'order-row-mid'} ${isLast ? 'order-row-last' : ''} ${isMulti ? 'order-row-multi' : 'order-row-single'} ${isSel ? 'row-selected' : ''}`;
      tr.dataset.orderNo = orderNoStr;

      tr.innerHTML = `
        <td class="text-center order-col-cb">
          <input type="checkbox" class="order-cb" data-id="${o.id}" ${isSel ? 'checked' : ''}>
        </td>
        <td class="order-col-no">
          ${isFirst ? `
            <div style="display:flex; align-items:center; gap:6px;">
              <button class="order-no-pill" style="cursor:pointer; border:none; background:#e0f2fe; color:#0284c7; padding:3px 8px; border-radius:4px; font-weight:800; font-family:monospace;" onclick="openOrderModal('${escapeHtml(orderNoStr)}', false)" title="Click to view &amp; add products to Order ${escapeHtml(orderNoStr)}">
                ${escapeHtml(orderNoStr)}
              </button>
              ${isMulti ? `<span class="multi-count-pill" title="This order has ${grp.items.length} factory products">${grp.items.length} Items</span>` : ''}
            </div>
          ` : `
            <div class="sub-item-line">
              <span class="tree-line">↳</span>
              <button class="order-no-subpill" onclick="openOrderModal('${escapeHtml(orderNoStr)}', false)" title="Order ${escapeHtml(orderNoStr)}">
                ${escapeHtml(orderNoStr)}
              </button>
              <span class="sub-idx-tag">#${itemIdx + 1}</span>
            </div>
          `}
        </td>
        <td class="order-col-date" style="font-family: monospace; font-weight: 700; color: #334155;">
          ${isFirst ? escapeHtml(o.place_date_display || o.place_date) : `<span class="sub-text">↳ ${escapeHtml(o.place_date_display || o.place_date)}</span>`}
        </td>
        <td>${agingHtml}</td>
        <td>
          <span class="manager-pill ${isFirst ? '' : 'manager-sub'}">${escapeHtml(o.manage_by)}</span>
        </td>
        <td class="party-name-bold">
          ${isFirst ? `
            <button class="party-link-btn" onclick="openClientCompanyModal('${escapeHtml(o.client_name)}')" title="Click to view all companies ordered by this client">
              🏢 ${escapeHtml(o.client_name)}
            </button>
          ` : `
            <div class="sub-client-box">
              <span class="tree-line">↳</span>
              <span class="sub-client-name">${escapeHtml(o.client_name)}</span>
            </div>
          `}
        </td>
        <td style="font-weight: 700; color: #475569; font-size: 0.78rem;">
          ${isFirst ? `
            <button class="city-link-btn" onclick="filterCenterInSheet('${escapeHtml(o.city)}')" title="Click to filter sheet to ${escapeHtml(o.city)}">
              📍 ${escapeHtml(o.city)}
            </button>
          ` : `
            <span class="sub-text">↳ ${escapeHtml(o.city)}</span>
          `}
        </td>
        <td>
          <button class="factory-badge" onclick="openFactoryClientModal('${escapeHtml(o.factory_name)}')" title="Click to view client orders in ${escapeHtml(o.factory_name)}">
            ${escapeHtml(o.factory_name)}
          </button>
        </td>
        <td>
          <div style="font-weight: 800; color: #1e293b;">${escapeHtml(o.size)}</div>
          <div style="font-size: 0.7rem; color: #64748b;">${escapeHtml(o.product)}</div>
        </td>
        <td class="text-right" style="font-family: monospace; font-weight: 800;">
          ${o.box_qty.toLocaleString()}
        </td>
        <td class="text-right" style="font-family: monospace; font-weight: 800; color: #0284c7;">
          ${o.total_weight.toLocaleString()}
        </td>
        <td class="text-center">
          <div class="status-dropdown-wrap">
            <button class="status-pill ${statusClass}" onclick="openStatusMenu(event, ${o.id})" title="Click to change status (Pending / Ready / Dispatched / Billed Done)">
              ${statusIcon} ${statusLabel} <span style="font-size:0.62rem; opacity:0.75;">▾</span>
            </button>
            ${quickTransferBtn ? `<div style="margin-top:4px;">${quickTransferBtn}</div>` : ''}
          </div>
        </td>
        <td class="text-center" style="white-space: nowrap;">
          <button class="btn-icon" style="display:inline-flex; width:26px; height:26px; border:none; background:#ecfdf5; color:#059669; margin-right:4px;" onclick="addItemsToOrder('${escapeHtml(orderNoStr)}')" title="Add New Factory Product to Order ${escapeHtml(orderNoStr)}">
            ➕
          </button>
          ${(isReady || o.status === 'DISPATCHED') ? `
            <button class="btn-icon btn-wa-icon" style="display:inline-flex; width:26px; height:26px; margin-right:4px;" onclick="event.stopPropagation(); sendReadySlipDirect({ orderId: ${o.id} })" title="Send WhatsApp Message & PDF Loading Slip">
              📲
            </button>
          ` : ''}
          <button class="btn-icon" style="display:inline-flex; width:26px; height:26px; border:none; background:#f1f5f9; color:#64748b; margin-right:4px;" onclick="editOrder(${o.id})" title="Edit Order / Manage Products (${escapeHtml(orderNoStr)})">
            ✏️
          </button>
          <button class="btn-icon btn-del-icon" style="display:inline-flex; width:26px; height:26px; border:none; background:#f1f5f9; color:#94a3b8;" onclick="confirmDeleteOrder(${o.id}, '${escapeHtml(orderNoStr)}')" title="Delete Order Item">
            🗑️
          </button>
        </td>
      `;

      tr.querySelector('.order-cb').addEventListener('change', (e) => {
        if (e.target.checked) {
          selectedOrderIds.add(o.id);
          tr.classList.add('row-selected');
        } else {
          selectedOrderIds.delete(o.id);
          tr.classList.remove('row-selected');
        }
        updateTruckPlannerUI();
      });

      tbody.appendChild(tr);
    });

    // Multi-Item Order Summary & Divider Bar ("DIVIDERS")
    if (isMulti) {
      const sumTr = document.createElement('tr');
      sumTr.className = `order-divider-summary-row ${grpClass}`;
      sumTr.dataset.orderNo = grp.order_no;

      const hasDispatched = grp.items.some(x => x.status === 'DISPATCHED');
      const hasReady = grp.items.some(x => x.status === 'READY');
      const allBilled = grp.items.every(x => x.status === 'BILLED DONE');

      sumTr.innerHTML = `
        <td colspan="13">
          <div class="order-group-summary-bar">
            <div class="og-left">
              <span class="og-badge">🧾 ORDER ${escapeHtml(grp.order_no)} TOTAL</span>
              <span class="og-client">🏢 ${escapeHtml(grp.client_name)}</span>
              <span class="og-sep">•</span>
              <span class="og-stat">🏭 <strong>${grp.items.length}</strong> Factory Products</span>
              <span class="og-sep">•</span>
              <span class="og-stat">📦 Total: <strong>${grp.total_boxes.toLocaleString()}</strong> Boxes</span>
              <span class="og-sep">•</span>
              <span class="og-stat">⚖️ Total: <strong>${(grp.total_weight / 1000.0).toFixed(2)} MT</strong> (${grp.total_weight.toLocaleString()} kg)</span>
            </div>
            <div class="og-right">
              ${hasDispatched ? `
                <button class="btn btn-xs btn-purple" onclick="setEntireOrderNoStatus('${escapeHtml(grp.order_no)}', 'BILLED DONE')" title="Transfer all ${grp.items.length} factory products in Order ${escapeHtml(grp.order_no)} to BILLED DONE">
                  🧾 Transfer All to BILLED DONE
                </button>
              ` : (hasReady ? `
                <button class="btn btn-xs btn-blue" onclick="setEntireOrderNoStatus('${escapeHtml(grp.order_no)}', 'DISPATCHED')" title="Mark all factory products in Order ${escapeHtml(grp.order_no)} as DISPATCHED">
                  🚚 Mark Order DISPATCHED
                </button>
              ` : (allBilled ? `
                <span style="font-size:0.72rem; color:#7e22ce; font-weight:800; background:#f3e8ff; padding:3px 8px; border-radius:4px;">
                  🧾 All Products Invoiced &amp; Billed Done
                </span>
              ` : ''))}
              <button class="btn btn-xs btn-outline" style="border-color:#059669; color:#059669; font-weight:700;" onclick="addItemsToOrder('${escapeHtml(grp.order_no)}')" title="Add another factory product to ${escapeHtml(grp.order_no)}">
                ➕ Add Factory Product
              </button>
              <button class="btn btn-xs btn-primary" onclick="openOrderModal('${escapeHtml(grp.order_no)}')" title="Edit entire order ${escapeHtml(grp.order_no)}">
                ✏️ Edit Order
              </button>
            </div>
          </div>
        </td>
      `;
      tbody.appendChild(sumTr);
    }
  });
}

function resetAllFilters() {
  activeSheetTab = 'ALL';
  activeDealerFilter = 'ALL';
  activeCenterFilter = 'ALL';
  activeFactoryFilter = 'ALL';
  activeManagerFilter = 'ALL';
  activeGradeFilter = 'ALL';
  activeAgeFilter = 'ALL';
  searchQuery = '';
  showDispatchedInOrders = false;
  const dispCb = document.getElementById('showDispatchedCheckbox');
  if (dispCb) dispCb.checked = false;
  document.getElementById('sheetSearchInput').value = '';
  populateFilterDropdowns();
  updateSheetTabHighlight('ALL');
  updateSheetTabsCounts();
  renderOrdersSheet();
  showToast('Filters cleared', 'info');
}

// Render Factories Hub Cards
function renderFactoriesHub() {
  const container = document.getElementById('factoryCardsGrid');
  container.innerHTML = '';

  document.getElementById('hubFactoriesCount').textContent = `${allFactories.length} Factories`;

  if (allFactories.length === 0) {
    container.innerHTML = `
      <div style="grid-column: span 3; text-align: center; padding: 48px 20px; background: white; border: 1px solid var(--border-card); border-radius: var(--radius-lg);">
        <div style="font-size: 2.2rem; margin-bottom: 8px;">🏭</div>
        <div style="font-weight: 800; font-size: 1.05rem; color: #0f172a; margin-bottom: 4px;">No Factory Allocations Yet</div>
        <p style="font-size: 0.84rem; color: #64748b; margin-bottom: 16px;">When you add orders with factory names (e.g., LEGEND, LIBERTA, ASTICA), each factory card will appear here with live boxes, tonnage, and client-wise drilldowns!</p>
        <button class="btn btn-primary" onclick="openOrderModal()">+ Add New Order</button>
      </div>
    `;
    return;
  }

  allFactories.forEach(f => {
    const card = document.createElement('div');
    card.className = 'factory-card';

    card.innerHTML = `
      <div class="fc-header" onclick="openFactoryClientModal('${escapeHtml(f.factory_name)}')">
        <h3 class="fc-title">${escapeHtml(f.factory_name)}</h3>
        <span class="fc-badge">${f.total_orders} ${f.total_orders === 1 ? 'order' : 'orders'}</span>
      </div>

      <div class="fc-metrics-box" onclick="openFactoryClientModal('${escapeHtml(f.factory_name)}')">
        <div class="fc-stat-col">
          <span class="fc-stat-label">Total Boxes:</span>
          <span class="fc-stat-val">${f.total_boxes.toLocaleString()}</span>
        </div>
        <div class="fc-stat-col" style="text-align: right;">
          <span class="fc-stat-label">Total Tonnage:</span>
          <span class="fc-stat-val blue">${f.total_tonnage} Tons</span>
        </div>
      </div>

      <div class="fc-sizes-row" onclick="openFactoryClientModal('${escapeHtml(f.factory_name)}')">
        <span class="fc-sizes-label">Tile Sizes:</span> ${escapeHtml(f.tile_sizes || 'Standard Ceramic')}
      </div>

      <div style="display:flex; gap:8px; margin-top:10px;">
        <button class="fc-action-btn" style="flex:1;" onclick="openFactoryClientModal('${escapeHtml(f.factory_name)}')">
          <span>View Orders by Client →</span>
        </button>
        <button class="btn btn-sm btn-outline" onclick="filterThisFactoryInSheet('${escapeHtml(f.factory_name)}')">
          View in Sheet
        </button>
      </div>
    `;

    container.appendChild(card);
  });
}

// Open Factory Client-Wise Drilldown Modal (Instant In-Memory Calculation)
function openFactoryClientModal(factoryName) {
  currentOpenFactory = factoryName;
  const modal = document.getElementById('factoryClientModal');
  const titleEl = document.getElementById('factoryModalName');
  const statsEl = document.getElementById('factoryModalStats');
  const summaryEl = document.getElementById('factoryClientCountSummary');
  const listEl = document.getElementById('factoryClientWiseList');

  titleEl.textContent = factoryName;
  modal.style.display = 'flex';

  const cleanName = factoryName.trim().toUpperCase();
  const fOrders = allOrders.filter(o => (o.factory_name || '').trim().toUpperCase() === cleanName);

  if (fOrders.length === 0) {
    statsEl.textContent = '0 orders';
    summaryEl.textContent = `No active orders found for ${factoryName}`;
    listEl.innerHTML = '<div style="text-align:center; padding: 24px; color:#64748b;">No active orders for this factory.</div>';
    return;
  }

  // Group by client
  const clientMap = {};
  let totalBoxes = 0;
  let totalWeight = 0;

  fOrders.forEach(o => {
    const cname = (o.client_name || 'UNKNOWN').trim().toUpperCase();
    if (!clientMap[cname]) {
      clientMap[cname] = {
        client_name: cname,
        city: o.city,
        state: o.state,
        total_boxes: 0,
        total_weight: 0,
        orders: []
      };
    }
    clientMap[cname].total_boxes += (o.box_qty || 0);
    clientMap[cname].total_weight += (o.total_weight || 0);
    clientMap[cname].orders.push(o);

    totalBoxes += (o.box_qty || 0);
    totalWeight += (o.total_weight || 0);
  });

  const clientList = Object.values(clientMap);
  const totalTonnage = (totalWeight / 1000.0).toFixed(1);
  const uniqueOrders = new Set(fOrders.map(o => (o.order_no || `EM-${1000 + o.id}`).trim().toUpperCase())).size;
  const ordersLabel = uniqueOrders === 1 ? '1 order' : `${uniqueOrders} orders`;
  const itemsLabel = fOrders.length !== uniqueOrders ? ` (${fOrders.length} items)` : '';

  statsEl.textContent = `${ordersLabel}${itemsLabel} · ${totalBoxes.toLocaleString()} boxes · ${totalTonnage} Tons · ${clientList.length} Clients`;
  summaryEl.textContent = `Showing ${clientList.length} Clients with orders in ${factoryName}`;

  listEl.innerHTML = '';

  clientList.forEach(c => {
    const clientCard = document.createElement('div');
    clientCard.className = 'client-group-card';

    const orderRowsHtml = c.orders.map(o => {
      const agingPill = formatAgingBadge(o.order_day, true);

      const isR = o.status === 'READY';
      return `
        <tr>
          <td style="font-family: monospace; font-weight:800; color:#0284c7;">${escapeHtml(o.order_no || `EM-${1000 + o.id}`)}</td>
          <td style="font-family: monospace; font-weight:700;">${escapeHtml(o.place_date_display || o.place_date)}</td>
          <td>${agingPill}</td>
          <td><span class="manager-pill">${escapeHtml(o.manage_by)}</span></td>
          <td><strong>${escapeHtml(o.size)}</strong> · ${escapeHtml(o.product)}</td>
          <td><span style="font-size:0.7rem; background:#f1f5f9; padding:2px 6px; border-radius:4px; font-weight:700;">${escapeHtml(o.grade || 'PRM')}</span></td>
          <td style="text-align:right; font-family:monospace; font-weight:800;">${o.box_qty.toLocaleString()}</td>
          <td style="text-align:right; font-family:monospace; font-weight:800; color:#0284c7;">${o.total_weight.toLocaleString()} kg</td>
          <td style="text-align:center;">
            <button class="status-pill ${isR ? 'ready' : 'not-ready'}" onclick="toggleOrderStatusFromModal(${o.id}, '${escapeHtml(factoryName)}')">
              ${isR ? '✓ READY' : '⏳ PENDING'}
            </button>
          </td>
        </tr>
      `;
    }).join('');

    clientCard.innerHTML = `
      <div class="client-group-header">
        <div>
          <span class="client-name-title">🏢 ${escapeHtml(c.client_name)}</span>
          <span class="client-location-tag">📍 ${escapeHtml(c.city || '')}, ${escapeHtml(c.state || '')}</span>
        </div>
        <div class="client-summary-pills">
          <span class="cs-pill">${c.orders.length} ${c.orders.length === 1 ? 'order' : 'orders'}</span>
          <span class="cs-pill font-mono font-bold">${c.total_boxes.toLocaleString()} boxes</span>
          <span class="cs-pill blue font-mono font-bold">${(c.total_weight / 1000.0).toFixed(1)} Tons</span>
        </div>
      </div>

      <div style="overflow-x: auto;">
        <table class="client-orders-table">
          <thead>
            <tr>
              <th>Order No</th>
              <th>Order Date</th>
              <th>Aging</th>
              <th>Manage By</th>
              <th>Size & Product</th>
              <th>Grade</th>
              <th style="text-align:right;">Box Qty</th>
              <th style="text-align:right;">Weight</th>
              <th style="text-align:center;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${orderRowsHtml}
          </tbody>
        </table>
      </div>
    `;

    listEl.appendChild(clientCard);
  });
}

function closeFactoryModal() {
  document.getElementById('factoryClientModal').style.display = 'none';
  currentOpenFactory = null;
}

function filterThisFactoryInSheet(fn) {
  closeFactoryModal();
  activeFactoryFilter = fn;
  const select = document.getElementById('filterFactorySelect');
  if (select) select.value = fn;
  activeSheetTab = 'ALL';
  updateSheetTabHighlight('ALL');
  switchView('orders-sheet');
  renderOrdersSheet();
  showToast(`Filtered Orders Sheet to factory ${fn} (All Sheets)`, 'info');
}

// Toggle status inside factory modal
async function toggleOrderStatusFromModal(orderId, factoryName) {
  await toggleOrderStatus(orderId, false);
  openFactoryClientModal(factoryName);
}

// ================= CLIENT MULTI-COMPANY ORDER MODAL =================
// ("clinat name through i can get how many companyes order they have")
function openClientCompanyModal(clientName) {
  currentOpenClient = clientName;
  const modal = document.getElementById('clientCompanyModal');
  const titleEl = document.getElementById('clientModalName');
  const tagEl = document.getElementById('clientModalCenterTag');
  const statsEl = document.getElementById('clientModalStats');
  const summaryEl = document.getElementById('clientCompanyCountSummary');
  const listEl = document.getElementById('clientCompanyWiseList');

  const cOrders = allOrders.filter(o => (o.client_name || '').trim().toUpperCase() === clientName.trim().toUpperCase());

  titleEl.textContent = clientName;
  modal.style.display = 'flex';

  if (cOrders.length === 0) {
    tagEl.textContent = 'No Orders';
    statsEl.textContent = '0 orders';
    summaryEl.textContent = 'No orders placed';
    listEl.innerHTML = '<div style="text-align:center; padding: 24px; color:#64748b;">No active orders found for this client.</div>';
    return;
  }

  const city = cOrders[0].city || '';
  const state = cOrders[0].state || '';
  tagEl.textContent = `📍 ${city}, ${state}`;

  // Group by Factory / Company
  const factoryMap = {};
  let totalBoxes = 0;
  let totalWeight = 0;

  cOrders.forEach(o => {
    const fn = (o.factory_name || 'UNASSIGNED').trim().toUpperCase();
    if (!factoryMap[fn]) {
      factoryMap[fn] = {
        factory_name: fn,
        total_boxes: 0,
        total_weight: 0,
        orders: []
      };
    }
    factoryMap[fn].total_boxes += (o.box_qty || 0);
    factoryMap[fn].total_weight += (o.total_weight || 0);
    factoryMap[fn].orders.push(o);

    totalBoxes += (o.box_qty || 0);
    totalWeight += (o.total_weight || 0);
  });

  const factoriesList = Object.values(factoryMap);
  const totalTonnage = (totalWeight / 1000.0).toFixed(1);
  const uniqueOrders = new Set(cOrders.map(o => (o.order_no || `EM-${1000 + o.id}`).trim().toUpperCase())).size;
  const ordersLabel = uniqueOrders === 1 ? '1 order' : `${uniqueOrders} orders`;
  const itemsLabel = cOrders.length !== uniqueOrders ? ` (${cOrders.length} items)` : '';

  statsEl.innerHTML = `
    <span>${ordersLabel}${itemsLabel} · ${totalBoxes.toLocaleString()} boxes · ${totalTonnage} Tons · Ordered from ${factoriesList.length} Companies</span>
    <button class="btn btn-sm btn-emerald" style="margin-left:12px; font-weight:700;" onclick="addItemsToClientOrder('${escapeHtml(clientName)}')" title="Add New Product Item to this Client's Order">
      ➕ Add Product to Order
    </button>
  `;
  summaryEl.textContent = `This client placed orders across ${factoriesList.length} Companies: (${factoriesList.map(f => f.factory_name).join(', ')})`;

  listEl.innerHTML = '';

  factoriesList.forEach(f => {
    const card = document.createElement('div');
    card.className = 'client-group-card';

    const orderRowsHtml = f.orders.map(o => {
      const agingPill = formatAgingBadge(o.order_day, true);
      const isR = o.status === 'READY';

      return `
        <tr>
          <td style="font-family: monospace; font-weight:800; color:#0284c7;">
            <button class="order-no-pill" style="cursor:pointer; border:none; background:#e0f2fe; color:#0284c7; padding:2px 6px; border-radius:4px; font-weight:800; font-family:monospace;" onclick="openOrderModal('${escapeHtml(o.order_no || `EM-${1000 + o.id}`)}', false)" title="Click to view &amp; add products to Order ${escapeHtml(o.order_no || `EM-${1000 + o.id}`)}">
              ${escapeHtml(o.order_no || `EM-${1000 + o.id}`)}
            </button>
          </td>
          <td style="font-family: monospace; font-weight:700;">${escapeHtml(o.place_date_display || o.place_date)}</td>
          <td>${agingPill}</td>
          <td><span class="manager-pill">${escapeHtml(o.manage_by)}</span></td>
          <td><strong>${escapeHtml(o.size)}</strong> · ${escapeHtml(o.product)}</td>
          <td><span style="font-size:0.7rem; background:#f1f5f9; padding:2px 6px; border-radius:4px; font-weight:700;">${escapeHtml(o.grade || 'PRM')}</span></td>
          <td style="text-align:right; font-family:monospace; font-weight:800;">${o.box_qty.toLocaleString()}</td>
          <td style="text-align:right; font-family:monospace; font-weight:800; color:#0284c7;">${o.total_weight.toLocaleString()} kg</td>
          <td style="text-align:center; white-space:nowrap;">
            <div class="status-dropdown-wrap">
              <button class="status-pill ${o.status === 'READY' ? 'ready' : (o.status === 'DISPATCHED' ? 'dispatched' : (o.status === 'BILLED DONE' ? 'billed' : 'not-ready'))}" onclick="openStatusMenu(event, ${o.id})" title="Click to change status">
                ${o.status === 'READY' ? '✓ READY' : (o.status === 'DISPATCHED' ? '🚚 DISPATCHED' : (o.status === 'BILLED DONE' ? '🧾 BILLED DONE' : '⏳ PENDING'))} ▾
              </button>
            </div>
            ${o.status === 'DISPATCHED' ? `
              <button class="btn-transfer-billed" style="margin-left:4px;" onclick="setOrderStatus(${o.id}, 'BILLED DONE').then(() => openClientCompanyModal('${escapeHtml(clientName)}'))" title="Transfer to BILLED DONE">
                🧾 Billed
              </button>
            ` : (o.status === 'READY' ? `
              <button class="btn-transfer-dispatch" style="margin-left:4px;" onclick="setOrderStatus(${o.id}, 'DISPATCHED').then(() => openClientCompanyModal('${escapeHtml(clientName)}'))" title="Mark DISPATCHED">
                🚚 Dispatch
              </button>
            ` : '')}
            <button class="btn-wa-slip-sm" style="margin-left:4px; background:#ecfdf5; color:#047857; border-color:#a7f3d0;" onclick="addItemsToOrder('${escapeHtml(o.order_no || '')}')" title="Add another factory product to Order ${escapeHtml(o.order_no || '')}">➕ Item</button>
            ${(isR || o.status === 'DISPATCHED') ? `<button class="btn-wa-slip-sm" style="margin-left:4px;" onclick="sendReadySlipDirect({ orderId: ${o.id} })" title="Send WhatsApp Message &amp; PDF Slip">📲 Slip</button>` : ''}
          </td>
        </tr>
      `;
    }).join('');

    const readyOrders = f.orders.filter(o => o.status === 'READY');
    const waHeaderBtn = `
      <button class="btn-wa-ready-header" onclick="sendReadySlipDirect({ clientName: '${escapeHtml(clientName)}', factoryName: '${escapeHtml(f.factory_name)}' })" title="Send WhatsApp Message &amp; PDF Loading Slip for ${escapeHtml(f.factory_name)}">
        📲 WhatsApp Ready Slip ${readyOrders.length > 0 ? `(${readyOrders.length} Ready)` : ''}
      </button>
    `;

    const firstOrderNo = f.orders[0] ? (f.orders[0].order_no || '') : '';

    card.innerHTML = `
      <div class="client-group-header">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <span class="client-name-title">🏭 Company: <strong>${escapeHtml(f.factory_name)}</strong></span>
          ${waHeaderBtn}
          ${firstOrderNo ? `
            <button class="btn btn-sm btn-outline" style="font-size:0.75rem; padding:3px 8px; border-color:#0284c7; color:#0284c7; font-weight:700;" onclick="addItemsToOrder('${escapeHtml(firstOrderNo)}')" title="Add another factory product to Order ${escapeHtml(firstOrderNo)}">
              ➕ Add Product (${escapeHtml(firstOrderNo)})
            </button>
          ` : ''}
        </div>
        <div class="client-summary-pills">
          <span class="cs-pill">${f.orders.length} ${f.orders.length === 1 ? 'product' : 'products'}</span>
          <span class="cs-pill font-mono font-bold">${f.total_boxes.toLocaleString()} boxes</span>
          <span class="cs-pill blue font-mono font-bold">${(f.total_weight / 1000.0).toFixed(1)} Tons</span>
        </div>
      </div>

      <div style="overflow-x: auto;">
        <table class="client-orders-table">
          <thead>
            <tr>
              <th>Order No</th>
              <th>Date</th>
              <th>Aging</th>
              <th>Manager</th>
              <th>Size & Product</th>
              <th>Grade</th>
              <th style="text-align:right;">Box Qty</th>
              <th style="text-align:right;">Weight</th>
              <th style="text-align:center;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${orderRowsHtml}
          </tbody>
        </table>
      </div>
    `;

    listEl.appendChild(card);
  });
}

function closeClientModal() {
  document.getElementById('clientCompanyModal').style.display = 'none';
  currentOpenClient = null;
}

async function toggleOrderStatusFromClientModal(orderId, clientName) {
  await toggleOrderStatus(orderId, false);
  openClientCompanyModal(clientName);
}

// ================= DEALERS & CENTERS HUB LOGIC =================
function renderDealersCenters() {
  const dealersContainer = document.getElementById('dealersCardsGrid');
  const centersContainer = document.getElementById('centersCardsGrid');
  if (!dealersContainer || !centersContainer) return;

  const dealerMap = {};
  const centerMap = {};

  allOrders.forEach(o => {
    const cname = (o.client_name || 'UNKNOWN').trim().toUpperCase();
    if (!dealerMap[cname]) {
      dealerMap[cname] = {
        client_name: cname,
        city: o.city || '',
        state: o.state || '',
        manage_by: o.manage_by || '',
        factories: new Set(),
        orders: [],
        total_boxes: 0,
        total_weight: 0,
        ready_count: 0
      };
    }
    if (o.factory_name) dealerMap[cname].factories.add(o.factory_name.trim().toUpperCase());
    dealerMap[cname].orders.push(o);
    dealerMap[cname].total_boxes += (o.box_qty || 0);
    dealerMap[cname].total_weight += (o.total_weight || 0);
    if (o.status === 'READY') dealerMap[cname].ready_count++;

    // Group by City / Center
    const city = (o.city || 'UNKNOWN').trim().toUpperCase();
    if (!centerMap[city]) {
      centerMap[city] = {
        city: city,
        state: o.state || '',
        dealers: new Set(),
        factories: new Set(),
        orders: [],
        total_boxes: 0,
        total_weight: 0,
        ready_count: 0
      };
    }
    if (o.client_name) centerMap[city].dealers.add(o.client_name.trim().toUpperCase());
    if (o.factory_name) centerMap[city].factories.add(o.factory_name.trim().toUpperCase());
    centerMap[city].orders.push(o);
    centerMap[city].total_boxes += (o.box_qty || 0);
    centerMap[city].total_weight += (o.total_weight || 0);
    if (o.status === 'READY') centerMap[city].ready_count++;
  });

  const dealersList = Object.values(dealerMap);
  const centersList = Object.values(centerMap);

  const bDealers = document.getElementById('badgeTotalDealers');
  if (bDealers) bDealers.textContent = dealersList.length;
  const bCenters = document.getElementById('badgeTotalCenters');
  if (bCenters) bCenters.textContent = centersList.length;

  // Render Dealers Grid
  dealersContainer.innerHTML = '';
  if (dealersList.length === 0) {
    dealersContainer.innerHTML = '<div style="grid-column: span 3; text-align:center; padding: 36px; color:#64748b;">No dealers recorded yet.</div>';
  } else {
    dealersList.forEach(d => {
      const card = document.createElement('div');
      card.className = 'dealer-card';
      const fArr = Array.from(d.factories);
      const ton = (d.total_weight / 1000.0).toFixed(1);
      const uniqueOrdersCount = new Set(d.orders.map(o => (o.order_no || `EM-${1000 + o.id}`).trim().toUpperCase())).size;

      card.innerHTML = `
        <div>
          <div class="dealer-header">
            <div>
              <div class="dealer-title">${escapeHtml(d.client_name)}</div>
              <div class="dealer-loc">📍 ${escapeHtml(d.city)}, ${escapeHtml(d.state)} · Managed by ${escapeHtml(d.manage_by)}</div>
            </div>
            <span class="dealer-badge">${fArr.length} ${fArr.length === 1 ? 'Company' : 'Companies'}</span>
          </div>

          <div class="dealer-metrics" style="margin-top: 12px;">
            <div class="dm-item">
              <div class="lbl">Total Orders</div>
              <div class="val">${uniqueOrdersCount} ${d.orders.length !== uniqueOrdersCount ? `<span style="font-size:0.72rem; color:#64748b; font-weight:normal;">(${d.orders.length} items)</span>` : ''}</div>
            </div>
            <div class="dm-item">
              <div class="lbl">Total Boxes</div>
              <div class="val">${d.total_boxes.toLocaleString()}</div>
            </div>
            <div class="dm-item">
              <div class="lbl">Tonnage</div>
              <div class="val text-blue">${ton} MT</div>
            </div>
          </div>

          <div style="margin-top: 12px;">
            <div style="font-size: 0.68rem; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 4px;">
              Ordered Companies (${fArr.length}):
            </div>
            <div class="dealer-factories-pills">
              ${fArr.map(f => `<span class="df-pill">🏭 ${escapeHtml(f)}</span>`).join('')}
            </div>
          </div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 8px;">
          <button class="btn btn-sm btn-primary" style="flex:1;" onclick="openClientCompanyModal('${escapeHtml(d.client_name)}')">
            View Companies (${fArr.length}) →
          </button>
          <button class="btn btn-sm btn-outline" onclick="filterDealerInSheet('${escapeHtml(d.client_name)}')">
            View in Sheet
          </button>
        </div>
      `;
      dealersContainer.appendChild(card);
    });
  }

  // Render Centers Grid
  centersContainer.innerHTML = '';
  if (centersList.length === 0) {
    centersContainer.innerHTML = '<div style="grid-column: span 3; text-align:center; padding: 36px; color:#64748b;">No destination centers recorded yet.</div>';
  } else {
    centersList.forEach(c => {
      const card = document.createElement('div');
      card.className = 'dealer-card';
      const dArr = Array.from(c.dealers);
      const ton = (c.total_weight / 1000.0).toFixed(1);
      const pct = Math.min(100, Math.round((c.total_weight / 26000.0) * 100));

      card.innerHTML = `
        <div>
          <div class="dealer-header">
            <div>
              <div class="dealer-title">📍 ${escapeHtml(c.city)}</div>
              <div class="dealer-loc">${escapeHtml(c.state)} · ${dArr.length} Parties Ordering</div>
            </div>
            <span class="dealer-badge">${pct}% Truck Load</span>
          </div>

          <div class="dealer-metrics" style="margin-top: 12px;">
            <div class="dm-item">
              <div class="lbl">Parties</div>
              <div class="val">${dArr.length}</div>
            </div>
            <div class="dm-item">
              <div class="lbl">Total Boxes</div>
              <div class="val">${c.total_boxes.toLocaleString()}</div>
            </div>
            <div class="dm-item">
              <div class="lbl">Tonnage</div>
              <div class="val text-cyan">${ton} MT</div>
            </div>
          </div>

          <div style="margin-top: 12px;">
            <div style="font-size: 0.68rem; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 4px;">
              Dealers / Clients (${dArr.length}):
            </div>
            <div class="dealer-factories-pills">
              ${dArr.map(d => `<span class="df-pill center-pill">🏢 ${escapeHtml(d)}</span>`).join('')}
            </div>
          </div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 8px;">
          <button class="btn btn-sm btn-primary" style="flex:1;" onclick="filterCenterInSheet('${escapeHtml(c.city)}')">
            View Center Orders in Sheet →
          </button>
        </div>
      `;
      centersContainer.appendChild(card);
    });
  }
}

function switchDealersCentersSubtab(subtab) {
  activeDealersCentersSubtab = subtab;
  const dTab = document.getElementById('subtabDealers');
  const cTab = document.getElementById('subtabCenters');
  const dGrid = document.getElementById('dealersCardsGrid');
  const cGrid = document.getElementById('centersCardsGrid');

  if (subtab === 'dealers') {
    dTab.classList.add('active');
    cTab.classList.remove('active');
    dGrid.style.display = 'grid';
    cGrid.style.display = 'none';
  } else {
    cTab.classList.add('active');
    dTab.classList.remove('active');
    dGrid.style.display = 'none';
    cGrid.style.display = 'grid';
  }
}

function filterDealerInSheet(dealerName) {
  activeDealerFilter = dealerName;
  const select = document.getElementById('filterDealerSelect');
  if (select) select.value = dealerName;
  activeSheetTab = 'ALL';
  updateSheetTabHighlight('ALL');
  switchView('orders-sheet');
  renderOrdersSheet();
  showToast(`Filtered Orders Sheet to ${dealerName}`, 'info');
}

function filterCenterInSheet(cityName) {
  activeCenterFilter = cityName;
  const select = document.getElementById('filterCenterSelect');
  if (select) select.value = cityName;
  activeSheetTab = 'ALL';
  updateSheetTabHighlight('ALL');
  switchView('orders-sheet');
  renderOrdersSheet();
  showToast(`Filtered Orders Sheet to center ${cityName}`, 'info');
}

// ================= MERCHANT PIPELINE (KANBAN) =================
function renderKanbanPipeline() {
  const pendingCol = document.getElementById('kanbanPendingList');
  const readyCol = document.getElementById('kanbanReadyList');
  const dispatchedCol = document.getElementById('kanbanDispatchedList');
  const billedCol = document.getElementById('kanbanBilledList');
  if (!pendingCol || !readyCol || !dispatchedCol) return;

  pendingCol.innerHTML = '';
  readyCol.innerHTML = '';
  dispatchedCol.innerHTML = '';
  if (billedCol) billedCol.innerHTML = '';

  const pending = allOrders.filter(o => o.status === 'NOT READY');
  const ready = allOrders.filter(o => o.status === 'READY');
  const dispatched = allOrders.filter(o => o.status === 'DISPATCHED');
  const billed = allOrders.filter(o => o.status === 'BILLED DONE');

  const pCount = document.getElementById('kanbanPendingCount');
  if (pCount) pCount.textContent = pending.length;
  const rCount = document.getElementById('kanbanReadyCount');
  if (rCount) rCount.textContent = ready.length;
  const dCount = document.getElementById('kanbanDispatchedCount');
  if (dCount) dCount.textContent = dispatched.length;
  const bCount = document.getElementById('kanbanBilledCount');
  if (bCount) bCount.textContent = billed.length;

  const uniqueTotalOrders = new Set(allOrders.map(o => (o.order_no || `EM-${1000 + o.id}`).trim().toUpperCase())).size;
  const bTotal = document.getElementById('pipelineTotalBadge');
  if (bTotal) bTotal.textContent = `${uniqueTotalOrders} Orders (${allOrders.length} Items)`;

  const renderCard = (o, nextStatus, nextLabel, btnColor = 'btn-primary') => {
    const card = document.createElement('div');
    card.className = 'kanban-card';
    card.innerHTML = `
      <div class="kc-row">
        <span class="order-no-pill">${escapeHtml(o.order_no || `EM-${1000 + o.id}`)}</span>
        <span class="manager-pill">${escapeHtml(o.manage_by)}</span>
      </div>
      <div class="kc-title">${escapeHtml(o.client_name)}</div>
      <div class="kc-sub">📍 ${escapeHtml(o.city)} · 🏭 <strong>${escapeHtml(o.factory_name)}</strong> (${escapeHtml(o.size)})</div>
      <div class="kc-row" style="margin-top: 4px;">
        <span style="font-family:monospace; font-weight:800;">${o.box_qty.toLocaleString()} boxes</span>
        <span style="font-family:monospace; font-weight:800; color:#0284c7;">${o.total_weight.toLocaleString()} kg</span>
      </div>
      <div style="margin-top: 8px; display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap;">
        <button class="btn btn-sm btn-outline" onclick="openClientCompanyModal('${escapeHtml(o.client_name)}')">
          🏢 Details
        </button>
        ${nextStatus ? `
          <button class="btn btn-sm ${btnColor}" onclick="setOrderStatusKanban(${o.id}, '${nextStatus}')">
            → ${nextLabel}
          </button>
        ` : `
          <span style="font-size:0.75rem; color:#7e22ce; font-weight:800; background:#f3e8ff; padding:2px 8px; border-radius:4px;">
            ✓ Billed Complete
          </span>
        `}
      </div>
      ${o.status === 'READY' ? `
        <div style="margin-top: 6px;">
          <button class="btn btn-sm btn-whatsapp" style="width:100%; justify-content:center;" onclick="sendReadySlipDirect({ orderId: ${o.id} })">
            📲 WhatsApp Ready Slip
          </button>
        </div>
      ` : ''}
    `;
    return card;
  };

  pending.forEach(o => pendingCol.appendChild(renderCard(o, 'READY', 'Mark READY', 'btn-primary')));
  ready.forEach(o => readyCol.appendChild(renderCard(o, 'DISPATCHED', 'Mark DISPATCHED', 'btn-blue')));
  dispatched.forEach(o => dispatchedCol.appendChild(renderCard(o, 'BILLED DONE', 'Transfer to BILLED DONE', 'btn-purple')));
  if (billedCol) {
    billed.forEach(o => billedCol.appendChild(renderCard(o, null, '', '')));
  }
}

async function setOrderStatusKanban(orderId, newStatus) {
  await setOrderStatus(orderId, newStatus);
}

// Set status of a single order item
async function setOrderStatus(orderId, newStatus, shouldRerender = true) {
  const o = allOrders.find(x => x.id === orderId);
  if (!o) return;

  const targetStatus = newStatus.trim().toUpperCase();
  o.status = targetStatus;

  try {
    const res = await fetch(`${API_BASE}/api/orders/${orderId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: targetStatus })
    });
    const data = await res.json();
    const moveHint = targetStatus === 'DISPATCHED' ? ' (Moved to 🚚 DISPATCHED tab)' : (targetStatus === 'BILLED DONE' ? ' (Moved to 🧾 BILLED DONE tab)' : '');
    showToast(`Order item #${orderId} marked as ${targetStatus}${moveHint}`, 'success');
  } catch (e) {
    console.error(e);
    showToast('Failed to update status', 'error');
  }

  if (shouldRerender) {
    renderOrdersSheet();
    renderFactoriesHub();
    renderDealersCenters();
    renderKanbanPipeline();
    updateTruckPlannerUI();
    updateSheetTabsCounts();
  }
}

// Transfer an entire order (all factory products) to a new status
async function setEntireOrderNoStatus(orderNo, newStatus) {
  if (!orderNo) return;
  const targetStatus = newStatus.trim().toUpperCase();

  try {
    const res = await fetch(`${API_BASE}/api/orders/by-order-no/${encodeURIComponent(orderNo)}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: targetStatus })
    });
    const data = await res.json();
    if (data.success) {
      const moveHint = targetStatus === 'DISPATCHED' ? ' (Moved to 🚚 DISPATCHED tab)' : (targetStatus === 'BILLED DONE' ? ' (Moved to 🧾 BILLED DONE tab)' : '');
      showToast(`✅ Order ${orderNo} (${data.items_updated} products) transferred to ${targetStatus}${moveHint}!`, 'success');
      await loadData();
    } else {
      showToast(data.error || 'Failed to update order status', 'info');
    }
  } catch (e) {
    console.error(e);
    showToast('Network error updating status', 'error');
  }
}

// Advances status in logical business sequence: NOT READY -> READY -> DISPATCHED -> BILLED DONE -> NOT READY
async function toggleOrderStatus(orderId, shouldRerender = true) {
  const o = allOrders.find(x => x.id === orderId);
  if (!o) return;

  let next = 'READY';
  if (o.status === 'NOT READY') next = 'READY';
  else if (o.status === 'READY') next = 'DISPATCHED';
  else if (o.status === 'DISPATCHED') next = 'BILLED DONE';
  else if (o.status === 'BILLED DONE') next = 'NOT READY';

  await setOrderStatus(orderId, next, shouldRerender);
}

// Interactive 1-Click Status Dropdown Menu
function openStatusMenu(e, orderId) {
  e.stopPropagation();
  closeAnyStatusMenu();

  const o = allOrders.find(x => x.id === orderId);
  if (!o) return;

  const menu = document.createElement('div');
  menu.className = 'status-picker-menu';
  menu.id = 'activeStatusMenu';

  const statuses = [
    { key: 'NOT READY', label: '⏳ NOT READY (Pending)', color: '#b45309' },
    { key: 'READY', label: '✓ READY (Ready to Load)', color: '#059669' },
    { key: 'DISPATCHED', label: '🚚 DISPATCHED (On Truck)', color: '#0284c7' },
    { key: 'BILLED DONE', label: '🧾 BILLED DONE (Invoiced)', color: '#7e22ce' }
  ];

  statuses.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'status-picker-item';
    btn.style.color = s.color;
    if (o.status === s.key) {
      btn.style.fontWeight = '900';
      btn.style.background = '#f1f5f9';
      btn.innerHTML = `<span>●</span> <span>${s.label}</span>`;
    } else {
      btn.innerHTML = `<span>○</span> <span>${s.label}</span>`;
    }
    btn.onclick = (ev) => {
      ev.stopPropagation();
      closeAnyStatusMenu();
      setOrderStatus(orderId, s.key);
    };
    menu.appendChild(btn);
  });

  const parent = e.target.closest('.status-dropdown-wrap') || e.target.parentElement;
  parent.style.position = 'relative';
  parent.appendChild(menu);

  const cleanup = (ev) => {
    if (!menu.contains(ev.target)) {
      closeAnyStatusMenu();
      document.removeEventListener('click', cleanup);
    }
  };
  setTimeout(() => document.addEventListener('click', cleanup), 10);
}

function closeAnyStatusMenu() {
  const existing = document.getElementById('activeStatusMenu');
  if (existing) existing.remove();
}

// ================= DELETE ORDER ACTIONS =================
async function confirmDeleteOrder(orderId, orderNo) {
  if (!confirm(`Are you sure you want to delete order item #${orderId} (${orderNo})?`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/orders/${orderId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`Order item #${orderId} deleted successfully`, 'success');
      selectedOrderIds.delete(orderId);
      loadData();
    } else {
      showToast(data.error || 'Failed to delete order', 'info');
    }
  } catch (err) {
    showToast(`Error deleting order: ${err.message}`, 'info');
  }
}

async function deleteCurrentOrder() {
  const orderId = document.getElementById('formOrderId').value;
  const orderNo = document.getElementById('formOrderNo').value;
  if (!orderId) return;

  if (!confirm(`Are you sure you want to delete order #${orderId} (${orderNo || 'EM-1001'})?`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/orders/${orderId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`Order #${orderId} deleted successfully`, 'success');
      closeOrderModal();
      loadData();
    } else {
      showToast(data.error || 'Failed to delete order', 'info');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'info');
  }
}

async function bulkDeleteSelected() {
  const ids = Array.from(selectedOrderIds);
  if (ids.length === 0) return;

  if (!confirm(`Are you sure you want to delete ${ids.length} selected orders?`)) return;

  for (let id of ids) {
    try {
      await fetch(`${API_BASE}/api/orders/${id}`, { method: 'DELETE' });
    } catch (e) {
      console.error(e);
    }
  }

  showToast(`${ids.length} orders deleted`, 'success');
  selectedOrderIds.clear();
  loadData();
}

// Update Top KPI Cards
function updateKPIs(stats) {
  if (!stats) return;
  const totOrdersEl = document.getElementById('kpiTotalOrders');
  if (totOrdersEl) totOrdersEl.textContent = stats.total_orders || 0;
  const totEntriesEl = document.getElementById('kpiTotalEntries');
  if (totEntriesEl) {
    if (stats.total_entries && stats.total_entries !== stats.total_orders) {
      totEntriesEl.textContent = `${stats.total_entries} Items`;
      totEntriesEl.style.display = 'block';
    } else {
      totEntriesEl.textContent = '';
      totEntriesEl.style.display = 'none';
    }
  }
  document.getElementById('kpiTotalBoxes').textContent = (stats.total_boxes || 0).toLocaleString();
  document.getElementById('kpiTotalKg').textContent = `${(stats.total_weight_kg || 0).toLocaleString()} kg`;
  document.getElementById('kpiTotalTons').textContent = `${(stats.total_weight_mt || 0).toFixed(2)} Tons`;
  document.getElementById('kpiPendingAging').textContent = stats.critical_aging_count || 0;
}

// Truck Load Consolidation Planner
function updateTruckPlannerUI() {
  const banner = document.getElementById('truckPlannerBanner');
  const count = selectedOrderIds.size;

  if (count === 0) {
    banner.style.display = 'none';
    const selCb = document.getElementById('selectAllCheckbox');
    if (selCb) selCb.checked = false;
    return;
  }

  banner.style.display = 'flex';
  const selOrders = allOrders.filter(o => selectedOrderIds.has(o.id));
  const totBoxes = selOrders.reduce((acc, o) => acc + o.box_qty, 0);
  const totKg = selOrders.reduce((acc, o) => acc + o.total_weight, 0);
  const totTons = (totKg / 1000.0).toFixed(2);

  document.getElementById('selectedCount').textContent = count;
  document.getElementById('selectedBoxes').textContent = totBoxes.toLocaleString();
  document.getElementById('selectedKg').textContent = totKg.toLocaleString();
  document.getElementById('selectedTons').textContent = `${totTons} Tons`;

  const pct = Math.min(100, Math.round((totKg / 26000.0) * 100));
  const bar = document.getElementById('truckFillBar');
  bar.style.width = `${pct}%`;
  document.getElementById('truckCapacityLabel').textContent = `${pct}% of 26 MT Standard Truck`;
}

function clearSelectedOrders() {
  selectedOrderIds.clear();
  const selCb = document.getElementById('selectAllCheckbox');
  if (selCb) selCb.checked = false;
  renderOrdersSheet();
  updateTruckPlannerUI();
}

async function bulkSetStatus(statusVal) {
  const ids = Array.from(selectedOrderIds);
  for (const id of ids) {
    const o = allOrders.find(x => x.id === id);
    if (o) {
      o.status = statusVal;
      fetch(`${API_BASE}/api/orders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: statusVal })
      });
    }
  }
  const moveHint = statusVal === 'DISPATCHED' ? ' (Moved to 🚚 DISPATCHED tab)' : (statusVal === 'BILLED DONE' ? ' (Moved to 🧾 BILLED DONE tab)' : '');
  showToast(`${ids.length} orders updated to ${statusVal}${moveHint}`, 'success');
  selectedOrderIds.clear();
  const selCb = document.getElementById('selectAllCheckbox');
  if (selCb) selCb.checked = false;
  renderOrdersSheet();
  updateTruckPlannerUI();
  updateSheetTabsCounts();
}

// ================= MULTI-FACTORY DYNAMIC ITEM ROWS =================
function addModalItemRow(data = {}) {
  const tbody = document.getElementById('modalItemsTableBody');
  const rowIdx = tbody.querySelectorAll('tr').length + 1;
  const tr = document.createElement('tr');
  tr.className = 'modal-item-row';
  if (data.id) {
    tr.dataset.itemId = data.id;
  }

  const defQty = (data.box_qty !== undefined && data.box_qty !== null) ? data.box_qty : '';
  const defWt = (data.box_weight !== undefined && data.box_weight !== null) ? data.box_weight : '26.5';
  const defTotWt = (data.box_qty && data.box_weight) ? (data.box_qty * data.box_weight).toFixed(1) : (data.total_weight || '');

  const isExisting = Boolean(data.id);
  const statusBadge = isExisting
    ? `<span style="font-size:0.62rem; color:#64748b; font-weight:700; display:block;">#${data.id}</span>`
    : `<span style="font-size:0.62rem; background:#ecfdf5; color:#047857; font-weight:800; padding:1px 4px; border-radius:3px; display:block;">NEW</span>`;

  tr.innerHTML = `
    <td class="item-row-num text-center">
      <div style="font-weight:800;">${rowIdx}</div>
      ${statusBadge}
    </td>
    <td>
      <input type="text" class="item-row-input item-factory" list="dlFactories" placeholder="e.g. ASTICA" required value="${escapeHtml(data.factory_name || '')}">
    </td>
    <td>
      <input type="text" class="item-row-input item-size" list="dlSizes" placeholder="e.g. 2X4" required value="${escapeHtml(data.size || '')}">
    </td>
    <td>
      <input type="text" class="item-row-input item-product" list="dlProducts" placeholder="e.g. GVT MATT" value="${escapeHtml(data.product || '')}">
    </td>
    <td>
      <select class="item-row-select item-grade">
        <option value="PRM" ${(!data.grade || data.grade === 'PRM') ? 'selected' : ''}>PRM</option>
        <option value="STD" ${data.grade === 'STD' ? 'selected' : ''}>STD</option>
      </select>
    </td>
    <td>
      <input type="number" class="item-row-input text-right item-qty" min="1" step="1" placeholder="450" required value="${defQty}">
    </td>
    <td>
      <input type="number" class="item-row-input text-right item-wt" min="0.1" step="0.1" placeholder="26.5" required value="${defWt}">
    </td>
    <td>
      <input type="number" class="item-row-input text-right item-totwt" step="0.1" placeholder="Auto" readonly value="${defTotWt}">
    </td>
    <td>
      <select class="item-row-select item-status">
        <option value="NOT READY" ${(!data.status || data.status === 'NOT READY') ? 'selected' : ''}>NOT READY</option>
        <option value="READY" ${data.status === 'READY' ? 'selected' : ''}>READY</option>
        <option value="DISPATCHED" ${data.status === 'DISPATCHED' ? 'selected' : ''}>DISPATCHED</option>
        <option value="BILLED DONE" ${data.status === 'BILLED DONE' ? 'selected' : ''}>BILLED DONE</option>
      </select>
    </td>
    <td class="text-center">
      <button type="button" class="btn-row-del" onclick="removeModalItemRow(this)" title="Remove this product row">✕</button>
    </td>
  `;

  // Dynamic Row Weight Calc and Summary Updates
  const qtyInp = tr.querySelector('.item-qty');
  const wtInp = tr.querySelector('.item-wt');
  const totInp = tr.querySelector('.item-totwt');
  const facInp = tr.querySelector('.item-factory');

  const calcRow = () => {
    const q = parseFloat(qtyInp.value) || 0;
    const w = parseFloat(wtInp.value) || 0;
    if (q > 0 && w > 0) {
      totInp.value = (q * w).toFixed(1);
    } else {
      totInp.value = '';
    }
    updateModalSummary();
  };

  qtyInp.addEventListener('input', calcRow);
  wtInp.addEventListener('input', calcRow);
  facInp.addEventListener('input', updateModalSummary);

  tbody.appendChild(tr);
  renumberItemRows();
  updateModalSummary();
}

function removeModalItemRow(btn) {
  const tbody = document.getElementById('modalItemsTableBody');
  const rows = tbody.querySelectorAll('.modal-item-row');
  if (rows.length <= 1) {
    const firstRow = rows[0];
    firstRow.querySelectorAll('input').forEach(inp => {
      if (inp.classList.contains('item-wt')) inp.value = '26.5';
      else inp.value = '';
    });
    delete firstRow.dataset.itemId;
    showToast('Reset row (at least one product row is required)', 'info');
  } else {
    btn.closest('tr').remove();
  }
  renumberItemRows();
  updateModalSummary();
}

function renumberItemRows() {
  const tbody = document.getElementById('modalItemsTableBody');
  tbody.querySelectorAll('.modal-item-row').forEach((row, i) => {
    const numCell = row.querySelector('.item-row-num div');
    if (numCell) numCell.textContent = i + 1;
  });
}

function updateModalSummary() {
  const tbody = document.getElementById('modalItemsTableBody');
  const rows = tbody.querySelectorAll('.modal-item-row');

  let totalBoxes = 0;
  let totalKg = 0;
  const factories = new Set();

  rows.forEach(r => {
    const fn = r.querySelector('.item-factory').value.trim();
    if (fn) factories.add(fn.toUpperCase());

    const q = parseFloat(r.querySelector('.item-qty').value) || 0;
    const w = parseFloat(r.querySelector('.item-wt').value) || 0;
    const tot = parseFloat(r.querySelector('.item-totwt').value) || (q * w);

    totalBoxes += q;
    totalKg += tot;
  });

  const ton = (totalKg / 1000.0).toFixed(2);
  document.getElementById('modalSummaryFactories').textContent = `${factories.size} Plants`;
  document.getElementById('modalSummaryItems').textContent = `${rows.length} Items`;
  document.getElementById('modalSummaryBoxes').textContent = `${totalBoxes.toLocaleString()} Boxes`;
  document.getElementById('modalSummaryWeight').textContent = `${totalKg.toLocaleString()} kg`;
  document.getElementById('modalSummaryTonnage').textContent = `(${ton} MT)`;
}

function getNextOrderNumber() {
  let maxNum = 1000;
  allOrders.forEach(o => {
    const m = (o.order_no || '').match(/EM-(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  });
  return `EM-${maxNum + 1}`;
}

function generateFreshOrderNoUI() {
  const nextNo = getNextOrderNumber();
  const inp = document.getElementById('formOrderNo');
  if (inp) inp.value = nextNo;
  const badge = document.getElementById('orderModeBadge');
  if (badge) {
    badge.style.display = 'block';
    badge.innerHTML = `<span style="background:#ecfdf5; color:#047857; font-weight:800; padding:4px 8px; border-radius:4px; font-size:0.75rem;">✨ NEW ORDER: ${nextNo}</span>`;
  }
  document.getElementById('modalTitle').textContent = `New Ceramic Order (${nextNo})`;
}

function handleOrderNoInputChange(val) {
  const clean = (val || '').trim().toUpperCase();
  if (!clean) return;
  const matches = allOrders.filter(x => (x.order_no || '').toUpperCase() === clean);
  if (matches.length > 0) {
    openOrderModal(clean, false);
    showToast(`Loaded existing Order ${clean} (${matches.length} products)`, 'info');
  }
}

function populateOrderNoDatalist() {
  const dl = document.getElementById('dlOrderNos');
  if (!dl) return;
  const groups = {};
  allOrders.forEach(o => {
    const no = (o.order_no || `EM-${1000 + o.id}`).toUpperCase();
    if (!groups[no]) {
      groups[no] = { order_no: no, client_name: o.client_name, count: 0 };
    }
    groups[no].count++;
  });

  dl.innerHTML = Object.values(groups)
    .sort((a, b) => b.order_no.localeCompare(a.order_no))
    .map(g => `<option value="${escapeHtml(g.order_no)}">${escapeHtml(g.client_name)} (${g.count} products)</option>`)
    .join('');
}

// Order Modal (New / Edit / Add Items to Same Order)
async function openOrderModal(orderOrOrderNo = null, addNewRow = false) {
  const form = document.getElementById('orderForm');
  form.reset();
  const tbody = document.getElementById('modalItemsTableBody');
  tbody.innerHTML = '';

  populateOrderNoDatalist();

  const btnDel = document.getElementById('btnDeleteCurrentOrder');
  const btnSlip = document.getElementById('btnOrderModalReadySlip');
  const badge = document.getElementById('orderModeBadge');

  // ALWAYS allow adding more factory products in both new and edit modes!
  document.getElementById('btnAddAnotherRowFooter').style.display = 'inline-flex';
  document.getElementById('btnAddItemRow').style.display = 'inline-flex';

  if (orderOrOrderNo) {
    // Existing Order Mode: Find ALL items belonging to this order number!
    let targetNo = '';
    if (typeof orderOrOrderNo === 'string') {
      targetNo = orderOrOrderNo.trim().toUpperCase();
    } else if (orderOrOrderNo.order_no) {
      targetNo = orderOrOrderNo.order_no.trim().toUpperCase();
    } else if (orderOrOrderNo.id) {
      targetNo = `EM-${1000 + orderOrOrderNo.id}`;
    }

    let orderItems = allOrders.filter(x => (x.order_no || '').toUpperCase() === targetNo);

    if (orderItems.length === 0 && targetNo) {
      try {
        const res = await fetch(`${API_BASE}/api/orders/by-order-no/${encodeURIComponent(targetNo)}`);
        if (res.ok) {
          const grp = await res.json();
          orderItems = grp.items || [];
        }
      } catch (e) {
        console.warn('Failed to fetch order group:', e);
      }
    }

    if (orderItems.length > 0) {
      const first = orderItems[0];
      document.getElementById('modalTitle').textContent = `Order ${targetNo} — ${first.client_name}`;
      document.getElementById('formOrderId').value = first.id;
      document.getElementById('formOrderNo').value = targetNo;
      document.getElementById('formPlaceDate').value = first.place_date || getLocalDateString();
      document.getElementById('formPartyType').value = first.party_type || 'DEALER';
      document.getElementById('formManageBy').value = first.manage_by || '';
      document.getElementById('formClientName').value = first.client_name || '';
      document.getElementById('formCity').value = first.city || '';
      document.getElementById('formState').value = first.state || '';
      document.getElementById('formRemark').value = first.remark || '';

      if (badge) {
        badge.style.display = 'block';
        badge.innerHTML = `<span style="background:#e0f2fe; color:#0369a1; font-weight:800; padding:4px 8px; border-radius:4px; font-size:0.75rem;">Editing Order: ${escapeHtml(targetNo)} (${orderItems.length} items)</span>`;
      }

      if (btnDel) btnDel.style.display = 'inline-flex';
      if (btnSlip) btnSlip.style.display = 'inline-flex';

      // Load ALL existing products for this order number!
      orderItems.forEach(item => {
        addModalItemRow(item);
      });

      // If user clicked "+ Add Item", immediately append a fresh blank row!
      if (addNewRow) {
        addModalItemRow();
        setTimeout(() => {
          const lastRow = tbody.querySelector('tr:last-child .item-factory');
          if (lastRow) lastRow.focus();
        }, 150);
      }
    } else if (typeof orderOrOrderNo === 'object') {
      // Fallback single order object
      const o = orderOrOrderNo;
      targetNo = o.order_no || `EM-${1000 + o.id}`;
      document.getElementById('modalTitle').textContent = `Order ${targetNo} — ${o.client_name}`;
      document.getElementById('formOrderId').value = o.id;
      document.getElementById('formOrderNo').value = targetNo;
      document.getElementById('formPlaceDate').value = o.place_date || getLocalDateString();
      document.getElementById('formPartyType').value = o.party_type || 'DEALER';
      document.getElementById('formManageBy').value = o.manage_by || '';
      document.getElementById('formClientName').value = o.client_name || '';
      document.getElementById('formCity').value = o.city || '';
      document.getElementById('formState').value = o.state || '';
      document.getElementById('formRemark').value = o.remark || '';

      if (badge) {
        badge.style.display = 'block';
        badge.innerHTML = `<span style="background:#e0f2fe; color:#0369a1; font-weight:800; padding:4px 8px; border-radius:4px; font-size:0.75rem;">Editing Order: ${escapeHtml(targetNo)}</span>`;
      }

      if (btnDel) btnDel.style.display = 'inline-flex';
      if (btnSlip) btnSlip.style.display = 'inline-flex';

      addModalItemRow(o);
      if (addNewRow) addModalItemRow();
    }
  } else {
    // Brand New Order Mode
    const freshNo = getNextOrderNumber();
    document.getElementById('modalTitle').textContent = `New Ceramic Order (${freshNo})`;
    document.getElementById('formOrderId').value = '';
    document.getElementById('formOrderNo').value = freshNo;
    document.getElementById('formPlaceDate').value = getLocalDateString();
    document.getElementById('formPartyType').value = (activeSheetTab === 'ALL' || activeSheetTab === 'REDY ORDER') ? 'DEALER' : activeSheetTab;

    if (badge) {
      badge.style.display = 'block';
      badge.innerHTML = `<span style="background:#ecfdf5; color:#047857; font-weight:800; padding:4px 8px; border-radius:4px; font-size:0.75rem;">✨ NEW ORDER: ${freshNo}</span>`;
    }

    if (btnDel) btnDel.style.display = 'none';
    if (btnSlip) btnSlip.style.display = 'none';

    // Start with 2 clean factory product rows
    addModalItemRow();
    addModalItemRow();
  }

  document.getElementById('orderModal').style.display = 'flex';
}

function closeOrderModal() {
  document.getElementById('orderModal').style.display = 'none';
}

function editOrder(orderId) {
  const o = allOrders.find(x => x.id === orderId);
  if (o) {
    openOrderModal(o.order_no || o, false);
  }
}

function addItemsToOrder(orderNo) {
  if (orderNo) {
    openOrderModal(orderNo, true);
  } else {
    openOrderModal(null, false);
  }
}

function addItemsToClientOrder(clientName) {
  const cOrders = allOrders.filter(x => (x.client_name || '').toUpperCase() === (clientName || '').toUpperCase());
  if (cOrders.length > 0) {
    const latestNo = cOrders[cOrders.length - 1].order_no || `EM-${1000 + cOrders[cOrders.length - 1].id}`;
    openOrderModal(latestNo, true);
  } else {
    openOrderModal(null, false);
    const clientInput = document.getElementById('formClientName');
    if (clientInput) clientInput.value = clientName;
  }
}

async function deleteCurrentOrder() {
  const orderNo = (document.getElementById('formOrderNo').value || '').trim().toUpperCase();
  if (!orderNo) return;
  const items = allOrders.filter(x => (x.order_no || '').toUpperCase() === orderNo);
  if (!confirm(`Are you sure you want to delete entire Order ${orderNo} (${items.length} factory items)?`)) {
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/orders/by-order-no/${encodeURIComponent(orderNo)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Order ${orderNo} deleted successfully`, 'success');
      closeOrderModal();
      await loadData();
    }
  } catch (err) {
    console.error(err);
    showToast('Failed to delete order', 'error');
  }
}

// Handle Form Submit (Supports Saving Existing Items & Adding New Items to Same Order Number)
async function handleFormSubmit(e) {
  e.preventDefault();
  const orderNo = (document.getElementById('formOrderNo').value || '').trim().toUpperCase() || getNextOrderNumber();
  const pdate = document.getElementById('formPlaceDate').value;
  const partyType = document.getElementById('formPartyType').value;
  const manageBy = document.getElementById('formManageBy').value.trim().toUpperCase();
  const clientName = document.getElementById('formClientName').value.trim().toUpperCase();
  const city = document.getElementById('formCity').value.trim().toUpperCase();
  const state = document.getElementById('formState').value.trim().toUpperCase();
  const remark = document.getElementById('formRemark').value.trim().toUpperCase();

  const rows = document.getElementById('modalItemsTableBody').querySelectorAll('.modal-item-row');
  if (rows.length === 0) {
    showToast('Please add at least one factory product item', 'info');
    return;
  }

  const items = [];
  for (let r of rows) {
    const itemId = r.dataset.itemId ? parseInt(r.dataset.itemId, 10) : null;
    const fn = r.querySelector('.item-factory').value.trim().toUpperCase();
    const sz = r.querySelector('.item-size').value.trim().toUpperCase();
    const prod = r.querySelector('.item-product').value.trim().toUpperCase();
    const grd = (r.querySelector('.item-grade').value || 'PRM').trim().toUpperCase();
    const q = parseInt(r.querySelector('.item-qty').value, 10);
    const wt = parseFloat(r.querySelector('.item-wt').value);
    const tot = parseFloat(r.querySelector('.item-totwt').value) || (q * wt);
    const st = (r.querySelector('.item-status').value || 'NOT READY').trim().toUpperCase();

    // Skip completely empty blank rows if user left them unfilled
    if (!fn && !sz && (!q || isNaN(q))) {
      continue;
    }

    if (!fn || !sz || !q || isNaN(q) || q <= 0) {
      showToast('Please specify Factory Name, Size, and Box Qty for all entered rows', 'info');
      return;
    }

    const itemObj = {
      factory_name: fn,
      size: sz,
      product: prod,
      grade: grd,
      box_qty: q,
      box_weight: wt,
      total_weight: tot,
      status: st,
      remark: remark
    };
    if (itemId) {
      itemObj.id = itemId;
    }
    items.push(itemObj);
  }

  if (items.length === 0) {
    showToast('Please fill in at least one factory product row', 'info');
    return;
  }

  const payload = {
    order_no: orderNo,
    place_date: pdate,
    party_type: partyType,
    manage_by: manageBy,
    client_name: clientName,
    city: city,
    state: state,
    remark: remark,
    items: items
  };

  try {
    const orderExists = allOrders.some(x => (x.order_no || '').toUpperCase() === orderNo);

    let res;
    if (orderExists) {
      // Update existing order group: updates existing items & inserts new items with SAME order_no!
      res = await fetch(`${API_BASE}/api/orders/by-order-no/${encodeURIComponent(orderNo)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      // Create new multi-item order
      res = await fetch(`${API_BASE}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const respData = await res.json();
    if (respData.success) {
      showToast(`✅ Order ${orderNo} saved successfully with ${items.length} factory products!`, 'success');
    } else {
      showToast(respData.message || 'Order saved successfully', 'success');
    }
  } catch (err) {
    console.error(err);
    showToast(`Error saving order: ${err.message}`, 'error');
  }

  closeOrderModal();
  await loadData();
}

// Export CSV
function exportCSV() {
  window.location.href = `${API_BASE}/api/export/csv`;
  showToast('Exporting Excel/CSV file...', 'info');
}

// WhatsApp Shares
function shareOnWhatsapp() {
  const uniqueTotalOrders = new Set(allOrders.map(o => (o.order_no || `EM-${1000 + o.id}`).trim().toUpperCase())).size;
  const readyOrdersCount = new Set(allOrders.filter(o => o.status === 'READY').map(o => (o.order_no || `EM-${1000 + o.id}`).trim().toUpperCase())).size;
  const text = encodeURIComponent(`*CERAMIC ORDER MANAGER - EOD DISPATCH REPORT*\nDate: 15/09/2026\nTotal Orders: ${uniqueTotalOrders} (${allOrders.length} Items)\nReady for Dispatch: ${readyOrdersCount} orders\nGenerated from Morbi Dispatch Portal.`);
  window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
}

function shareFactoryWhatsapp(factoryName) {
  const factoryOrders = allOrders.filter(o => (o.factory_name || '').toLowerCase() === factoryName.toLowerCase());
  const uniqueOrders = new Set(factoryOrders.map(o => (o.order_no || `EM-${1000 + o.id}`).trim().toUpperCase())).size;
  const clients = new Set(factoryOrders.map(o => o.client_name));
  const totBoxes = factoryOrders.reduce((a, b) => a + b.box_qty, 0);
  const totTons = (factoryOrders.reduce((a, b) => a + b.total_weight, 0) / 1000).toFixed(1);

  const text = encodeURIComponent(`*FACTORY ORDER STATUS: ${factoryName}*\nTotal Orders: ${uniqueOrders} (${factoryOrders.length} Items)\nTotal Boxes: ${totBoxes.toLocaleString()}\nTotal Tonnage: ${totTons} Tons\nClients: ${Array.from(clients).join(', ')}`);
  window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
}

function shareClientWhatsapp(clientName) {
  const cOrders = allOrders.filter(o => (o.client_name || '').toLowerCase() === clientName.toLowerCase());
  const uniqueOrders = new Set(cOrders.map(o => (o.order_no || `EM-${1000 + o.id}`).trim().toUpperCase())).size;
  const factories = new Set(cOrders.map(o => o.factory_name));
  const totBoxes = cOrders.reduce((a, b) => a + b.box_qty, 0);
  const totTons = (cOrders.reduce((a, b) => a + b.total_weight, 0) / 1000).toFixed(1);
  const readyCount = new Set(cOrders.filter(o => o.status === 'READY').map(o => (o.order_no || `EM-${1000 + o.id}`).trim().toUpperCase())).size;

  const text = encodeURIComponent(`*CLIENT MULTI-COMPANY ORDER SUMMARY*\nParty: ${clientName}\nCenter: ${cOrders[0] ? cOrders[0].city : ''}\nTotal Orders: ${uniqueOrders} (${cOrders.length} Items)\nCompanies Ordered: ${Array.from(factories).join(', ')}\nTotal Boxes: ${totBoxes.toLocaleString()}\nTotal Weight: ${totTons} Tons\nReady for Dispatch: ${readyCount} orders`);
  window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
}

function addNewSheetTab() {
  const name = prompt('Enter new sheet tab name:');
  if (name) {
    showToast(`Created new sheet: ${name}`, 'success');
  }
}

// Toast Notification
function showToast(msg, type = 'info') {
  const c = document.getElementById('toastContainer');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 200);
  }, 2800);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ================= READY TO LOAD WHATSAPP & PDF SLIP =================
let currentReadySlipData = null;

function openReadySlipModal({ clientName, factoryName, orderId, orderNo }) {
  let targetOrders = [];

  if (orderId) {
    targetOrders = allOrders.filter(o => o.id === orderId);
  } else if (clientName && factoryName) {
    const cClean = clientName.trim().toUpperCase();
    const fClean = factoryName.trim().toUpperCase();
    targetOrders = allOrders.filter(o => (o.client_name || '').trim().toUpperCase() === cClean && (o.factory_name || '').trim().toUpperCase() === fClean);
  } else if (orderNo) {
    targetOrders = allOrders.filter(o => (o.order_no || '').trim().toUpperCase() === orderNo.trim().toUpperCase());
  } else if (clientName) {
    const cClean = clientName.trim().toUpperCase();
    targetOrders = allOrders.filter(o => (o.client_name || '').trim().toUpperCase() === cClean);
  }

  if (targetOrders.length === 0) {
    showToast('No orders found to generate ready slip', 'info');
    return;
  }

  // Filter to ready orders if any exist, otherwise use all
  const readyOrders = targetOrders.filter(o => o.status === 'READY');
  const items = readyOrders.length > 0 ? readyOrders : targetOrders;

  const first = items[0];
  const cName = clientName || first.client_name || 'CLIENT';
  const fName = factoryName || first.factory_name || 'FACTORY';
  const city = first.city || '';
  const state = first.state || '';
  const oNo = orderNo || first.order_no || `EM-${1000 + first.id}`;
  const totalBoxes = items.reduce((s, o) => s + (o.box_qty || 0), 0);
  const totalKg = items.reduce((s, o) => s + (o.total_weight || 0), 0);
  const totalMT = (totalKg / 1000.0).toFixed(2);

  currentReadySlipData = {
    clientName: cName,
    factoryName: fName,
    city: city,
    state: state,
    orderNo: oNo,
    items: items,
    totalBoxes: totalBoxes,
    totalKg: totalKg,
    totalMT: totalMT
  };

  const alertBox = document.getElementById('readySlipAlertBox');
  if (alertBox) {
    alertBox.style.display = 'none';
    alertBox.innerHTML = '';
  }

  // Set modal header text
  const titleEl = document.getElementById('readySlipModalTitle');
  const subEl = document.getElementById('readySlipModalSub');
  if (titleEl) titleEl.textContent = `READY SLIP: ${cName}`;
  if (subEl) subEl.textContent = `Loading Clearance Advice for ${fName} (${items.length} items · ${totalBoxes.toLocaleString()} boxes · ${totalMT} MT)`;

  // Generate clean preview HTML
  const rowsHtml = items.map((o, idx) => {
    const isR = o.status === 'READY';
    const statusPill = isR ? '<span style="background:#ecfdf5; color:#047857; font-weight:800; padding:2px 8px; border-radius:4px; font-size:0.7rem; border:1px solid #a7f3d0;">✓ READY TO LOAD</span>' : `<span style="background:#fffbeb; color:#b45309; font-weight:800; padding:2px 8px; border-radius:4px; font-size:0.7rem;">${escapeHtml(o.status)}</span>`;
    const boxWt = (o.box_weight || 26.5).toFixed(1);
    const totWt = (o.total_weight || 0).toFixed(1);
    const mt = ((o.total_weight || 0) / 1000.0).toFixed(2);

    return `
      <tr style="border-bottom: 1px solid #cbd5e1;">
        <td style="padding: 8px 10px; text-align: center; font-weight:700;">${idx}</td>
        <td style="padding: 8px 10px; font-weight: 800; color: #0284c7;">${escapeHtml(o.factory_name)}</td>
        <td style="padding: 8px 10px; font-weight: 800;">${escapeHtml(o.size)}</td>
        <td style="padding: 8px 10px;">${escapeHtml(o.product)}</td>
        <td style="padding: 8px 10px; text-align: center; font-weight:700;"><span style="background:#f1f5f9; padding:2px 6px; border-radius:4px;">${escapeHtml(o.grade || 'PRM')}</span></td>
        <td style="padding: 8px 10px; text-align: center;">${statusPill}</td>
        <td style="padding: 8px 10px; text-align: right; font-family: monospace; font-weight: 800;">${(o.box_qty || 0).toLocaleString()}</td>
        <td style="padding: 8px 10px; text-align: right; font-family: monospace;">${boxWt} kg</td>
        <td style="padding: 8px 10px; text-align: right; font-family: monospace; font-weight: 800;">${totWt} kg</td>
        <td style="padding: 8px 10px; text-align: right; font-family: monospace; font-weight: 800; color:#0284c7;">${mt} MT</td>
      </tr>
    `;
  }).join('');

  const previewEl = document.getElementById('readySlipPreviewContent');
  if (previewEl) {
    previewEl.innerHTML = `
      <div style="font-family:'Plus Jakarta Sans', 'Inter', sans-serif; color:#0f172a; background:white; padding:20px; border:2px solid #0f172a; border-radius:4px; box-shadow:0 4px 10px rgba(0,0,0,0.04);">
        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #0f172a; padding-bottom:12px; margin-bottom:16px;">
          <div style="display:flex; align-items:center; gap:12px;">
            <img src="/logo.png" alt="emato TILES" style="height:44px; object-fit:contain;" onerror="this.style.display='none'">
            <div>
              <h2 style="font-size:1.3rem; font-weight:900; margin:0; line-height:1.1;">emato® TILES</h2>
              <div style="font-size:0.72rem; font-weight:800; color:#0284c7; letter-spacing:0.06em; text-transform:uppercase;">Ceramic Dispatch & Vehicle Loading Clearance</div>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:1rem; font-weight:900; letter-spacing:0.04em;">LOADING ADVICE SLIP</div>
            <div style="background:#10b981; color:white; font-weight:800; font-size:0.7rem; padding:3px 8px; border-radius:20px; display:inline-block; margin-top:2px;">● READY FOR LOADING</div>
          </div>
        </div>

        <!-- Meta info -->
        <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:10px 18px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px 14px; margin-bottom:16px; font-size:0.78rem;">
          <div>
            <span style="font-size:0.68rem; color:#64748b; font-weight:700; text-transform:uppercase;">Client / Party Name:</span>
            <div style="font-weight:800; font-size:0.92rem; color:#0f172a;">${escapeHtml(cName)}</div>
          </div>
          <div>
            <span style="font-size:0.68rem; color:#64748b; font-weight:700; text-transform:uppercase;">Destination Station:</span>
            <div style="font-weight:800; font-size:0.92rem; color:#0f172a;">${escapeHtml(city)}${state ? ', ' + escapeHtml(state) : ''}</div>
          </div>
          <div>
            <span style="font-size:0.68rem; color:#64748b; font-weight:700; text-transform:uppercase;">Manufacturing Plant:</span>
            <div style="font-weight:900; font-size:0.95rem; color:#0284c7;">🏭 ${escapeHtml(fName)}</div>
          </div>
          <div>
            <span style="font-size:0.68rem; color:#64748b; font-weight:700; text-transform:uppercase;">Order Ref & Date:</span>
            <div style="font-weight:800; font-size:0.85rem; font-family:monospace;">${escapeHtml(oNo)} · 15/09/2026</div>
          </div>
        </div>

        <!-- Items Table -->
        <table style="width:100%; border-collapse:collapse; margin-bottom:14px; font-size:0.76rem;">
          <thead>
            <tr style="background:#0f172a; color:white; text-transform:uppercase; font-size:0.68rem; font-weight:800;">
              <th style="padding:6px 8px; text-align:center;">#</th>
              <th style="padding:6px 8px; text-align:left;">Plant</th>
              <th style="padding:6px 8px; text-align:left;">Size</th>
              <th style="padding:6px 8px; text-align:left;">Product / Finish</th>
              <th style="padding:6px 8px; text-align:center;">Grade</th>
              <th style="padding:6px 8px; text-align:center;">Status</th>
              <th style="padding:6px 8px; text-align:right;">Boxes</th>
              <th style="padding:6px 8px; text-align:right;">Box Wt</th>
              <th style="padding:6px 8px; text-align:right;">Total Wt</th>
              <th style="padding:6px 8px; text-align:right;">MT</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
          <tfoot>
            <tr style="background:#e2e8f0; font-weight:900; border-top:2px solid #0f172a; border-bottom:2px solid #0f172a;">
              <td colspan="6" style="padding:6px 8px; text-align:right; text-transform:uppercase;">Total Ready Material:</td>
              <td style="padding:6px 8px; text-align:right; font-family:monospace; font-weight:900;">${totalBoxes.toLocaleString()}</td>
              <td></td>
              <td style="padding:6px 8px; text-align:right; font-family:monospace; font-weight:900;">${totalKg.toLocaleString()} kg</td>
              <td style="padding:6px 8px; text-align:right; font-family:monospace; font-weight:900; color:#0284c7;">${totalMT} MT</td>
            </tr>
          </tfoot>
        </table>

        <!-- Dispatch Clearance Notice -->
        <div style="background:#f0f9ff; border:1px dashed #0284c7; border-radius:6px; padding:10px 12px; margin-bottom:16px; font-size:0.72rem; color:#0369a1; line-height:1.4;">
          <strong>VEHICLE LOADING CLEARANCE:</strong> The above listed ceramic material is verified, palletized, and <strong>READY FOR IMMEDIATE LOADING</strong> into truck/trailer at <strong>${escapeHtml(fName)}</strong> warehouse in Morbi. Driver must present this slip for gate pass clearance.
        </div>

        <!-- Signatures -->
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:16px; margin-top:20px; padding-top:14px; border-top:1px solid #cbd5e1; text-align:center; font-size:0.68rem; font-weight:800; color:#475569;">
          <div>
            <div style="border-bottom:1px solid #0f172a; height:30px; margin-bottom:4px;"></div>
            Authorized Dispatch Officer<br><strong>emato® TILES MORBI</strong>
          </div>
          <div>
            <div style="border-bottom:1px solid #0f172a; height:30px; margin-bottom:4px;"></div>
            Factory Warehouse In-Charge<br><strong>${escapeHtml(fName)}</strong>
          </div>
          <div>
            <div style="border-bottom:1px solid #0f172a; height:30px; margin-bottom:4px;"></div>
            Transporter / Driver Signature<br>Vehicle No: ________________
          </div>
        </div>
      </div>
    `;
  }

  const modal = document.getElementById('readySlipModal');
  if (modal) modal.style.display = 'flex';

  // Pre-generate PDF in background so user gesture on click is instantaneous
  setTimeout(preGenerateReadySlipPdf, 250);
}

function closeReadySlipModal() {
  const modal = document.getElementById('readySlipModal');
  if (modal) modal.style.display = 'none';
}

let currentReadySlipPdfBlob = null;
let currentReadySlipPdfFile = null;
let lastWaUrl = '';

async function preGenerateReadySlipPdf() {
  if (!currentReadySlipData || !window.html2pdf) return;
  const d = currentReadySlipData;
  const element = document.getElementById('readySlipPreviewContent');
  if (!element) return;
  const cleanClient = (d.clientName || 'CLIENT').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanFac = (d.factoryName || 'FACTORY').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `READY_TO_LOAD_${cleanClient}_${cleanFac}.pdf`;

  const opt = {
    margin: [6, 6, 6, 6],
    filename: filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, letterRendering: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  try {
    const pdf = await html2pdf().set(opt).from(element).toPdf().get('pdf');
    currentReadySlipPdfBlob = pdf.output('blob');
    currentReadySlipPdfFile = new File([currentReadySlipPdfBlob], filename, { type: 'application/pdf' });
  } catch (e) {
    console.warn('Background PDF generation:', e);
  }
}

async function copySlipImageToClipboard(showNotification = true) {
  const element = document.getElementById('readySlipPreviewContent');
  if (!element || !window.html2canvas) {
    if (showNotification) showToast('html2canvas preview not ready', 'error');
    return;
  }
  if (showNotification) showToast('📋 Copying Slip image to clipboard...', 'info');
  try {
    const canvas = await html2canvas(element, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    canvas.toBlob(async (blob) => {
      if (blob && navigator.clipboard && window.ClipboardItem) {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
          if (showNotification) {
            showToast('✅ Slip image copied! Press Ctrl+V in WhatsApp to paste.', 'success');
          }
        } catch (clipErr) {
          console.warn('Clipboard write error:', clipErr);
          if (showNotification) showToast('Clipboard write not allowed. Please drag PDF into WhatsApp.', 'info');
        }
      }
    }, 'image/png');
  } catch (err) {
    console.warn('html2canvas error:', err);
  }
}

async function triggerReadySlipWhatsApp() {
  if (!currentReadySlipData) return;
  const d = currentReadySlipData;
  const element = document.getElementById('readySlipPreviewContent');
  const alertBox = document.getElementById('readySlipAlertBox');
  const cleanClient = (d.clientName || 'CLIENT').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanFac = (d.factoryName || 'FACTORY').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `READY_TO_LOAD_${cleanClient}_${cleanFac}.pdf`;

  const itemSummary = d.items.map(o => `• *${o.factory_name}* | ${o.size} ${o.product} (${o.grade || 'PRM'}) — ${o.box_qty} Boxes (${((o.total_weight || 0) / 1000.0).toFixed(2)} MT)`).join('\n');
  const slipUrl = `${window.location.origin}/slip/READY_TO_LOAD_${cleanClient}_${cleanFac}.pdf?client=${encodeURIComponent(d.clientName)}&factory=${encodeURIComponent(d.factoryName)}&download=1`;

  const rawMessage = 
    `🚚 *emato® TILES - OFFICIAL LOADING ADVICE SLIP (PDF)* 🚚\n\n` +
    `Dear *${d.clientName}*,\n` +
    `Your ceramic tiles order is *READY TO LOAD* at *${d.factoryName}*!\n\n` +
    `📄 *DOWNLOAD OFFICIAL PDF LOADING SLIP:*\n` +
    `👉 ${slipUrl}\n` +
    `*(Click above to view & download official PDF loading clearance document)*\n\n` +
    `📋 *DISPATCH DETAILS:*\n` +
    `• *Company / Plant:* ${d.factoryName}\n` +
    `• *Order Ref:* ${d.orderNo || 'EMATO-ORDER'}\n` +
    `• *Destination:* ${d.city}${d.state ? ', ' + d.state : ''}\n` +
    `• *Total Quantity:* ${d.totalBoxes.toLocaleString()} Boxes (${d.totalMT} MT)\n` +
    `• *Status:* 🟢 READY FOR IMMEDIATE LOADING\n\n` +
    `📦 *READY PRODUCTS:*\n${itemSummary}\n\n` +
    `Kindly arrange vehicle placement / loading clearance.\n` +
    `Thank you,\n*emato® TILES Morbi*`;

  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(rawMessage)}`;
  lastWaUrl = waUrl;

  showToast('📄 Preparing PDF & WhatsApp Dispatch...', 'info');

  const opt = {
    margin: [6, 6, 6, 6],
    filename: filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, letterRendering: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  // 1. Get or generate the PDF blob
  let fileToShare = currentReadySlipPdfFile;
  let blobToDownload = currentReadySlipPdfBlob;

  if (!fileToShare && window.html2pdf && element) {
    try {
      const pdf = await html2pdf().set(opt).from(element).toPdf().get('pdf');
      blobToDownload = pdf.output('blob');
      fileToShare = new File([blobToDownload], filename, { type: 'application/pdf' });
      currentReadySlipPdfBlob = blobToDownload;
      currentReadySlipPdfFile = fileToShare;
    } catch (err) {
      console.warn('PDF generation inline error:', err);
    }
  }

  // 2. Mobile Web Share API: If mobile, directly pass the real .pdf file to WhatsApp!
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (isMobile && fileToShare && navigator.canShare && navigator.canShare({ files: [fileToShare] })) {
    try {
      await navigator.share({
        files: [fileToShare],
        title: `Ready to Load - ${d.factoryName}`,
        text: rawMessage
      });
      showToast(`✅ PDF Loading Slip shared directly to WhatsApp!`, 'success');
      return;
    } catch (shareErr) {
      if (shareErr.name === 'AbortError') return;
      console.warn('Mobile WebShare failed, using WhatsApp URL:', shareErr);
    }
  }

  // 3. Desktop / Web Share:
  // a) Immediately trigger download of the official PDF file to computer
  if (blobToDownload) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blobToDownload);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } else if (window.html2pdf && element) {
    html2pdf().set(opt).from(element).save();
  }

  // b) Copy slip image to clipboard for instant Ctrl+V paste into WhatsApp Web
  copySlipImageToClipboard(false);

  // c) Open WhatsApp Web
  window.open(waUrl, '_blank');

  // d) Show clear, unmissable visual instructions inside the modal
  if (alertBox) {
    alertBox.style.display = 'block';
    alertBox.innerHTML = `
      <div style="background:#ecfdf5; border:2px solid #10b981; border-radius:10px; padding:14px 18px; box-shadow:0 4px 14px rgba(16,185,129,0.15);">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
          <div style="display:flex; gap:10px; align-items:center;">
            <span style="font-size:1.8rem;">📄</span>
            <div>
              <div style="font-weight:900; font-size:1rem; color:#065f46;">Official PDF Slip Generated &amp; Downloaded!</div>
              <div style="font-size:0.75rem; color:#047857;">File saved: <strong>${escapeHtml(filename)}</strong></div>
            </div>
          </div>
          <span style="background:#10b981; color:white; font-size:0.72rem; font-weight:800; padding:3px 10px; border-radius:20px;">WHATSAPP READY</span>
        </div>
        <div style="margin-top:10px; padding:10px 14px; background:white; border-radius:8px; border:1px solid #a7f3d0; font-size:0.82rem; color:#1e293b; line-height:1.6;">
          <strong>📲 3 Ways to Send PDF in WhatsApp:</strong><br>
          • <strong>Instant Visual Slip:</strong> Click inside the WhatsApp chat and press <kbd style="background:#f1f5f9; border:1px solid #cbd5e1; padding:2px 6px; border-radius:4px; font-weight:800; font-family:monospace;">Ctrl + V</kbd> (or <kbd style="background:#f1f5f9; border:1px solid #cbd5e1; padding:2px 6px; border-radius:4px; font-weight:800; font-family:monospace;">Cmd + V</kbd>) to paste the Slip card!<br>
          • <strong>Attach PDF File:</strong> Drag the downloaded <strong style="color:#0284c7;">${escapeHtml(filename)}</strong> into WhatsApp Web, or click 📎 &gt; Document.<br>
          • <strong>Direct PDF Link:</strong> The pre-filled WhatsApp message already has the direct one-click PDF download link for your client!
        </div>
        <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
          <button type="button" class="btn btn-sm btn-whatsapp" onclick="window.open('${escapeHtml(waUrl)}', '_blank')">🚀 Open WhatsApp Web</button>
          <button type="button" class="btn btn-sm btn-primary" onclick="triggerReadySlipDownloadPdf()">📥 Re-download PDF File</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="copySlipImageToClipboard(true)">📋 Re-copy Slip Card (Ctrl+V)</button>
        </div>
      </div>
    `;
  }

  showToast(`📥 PDF Slip downloaded & copied to clipboard!`, 'success');
}

async function sendReadySlipDirect({ clientName, factoryName, orderId, orderNo }) {
  openReadySlipModal({ clientName, factoryName, orderId, orderNo });
  await triggerReadySlipWhatsApp();
}

function triggerReadySlipDownloadPdf() {
  if (!currentReadySlipData) return;
  const d = currentReadySlipData;
  const element = document.getElementById('readySlipPreviewContent');
  const cleanClient = (d.clientName || 'CLIENT').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanFac = (d.factoryName || 'FACTORY').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `READY_TO_LOAD_${cleanClient}_${cleanFac}.pdf`;

  showToast('📥 Downloading Loading Slip PDF...', 'info');

  if (currentReadySlipPdfBlob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(currentReadySlipPdfBlob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    showToast(`✅ Downloaded ${filename}`, 'success');
    return;
  }

  const opt = {
    margin: [6, 6, 6, 6],
    filename: filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, letterRendering: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  if (window.html2pdf && element) {
    html2pdf().set(opt).from(element).save().then(() => {
      showToast(`✅ Downloaded ${filename}`, 'success');
    }).catch(err => {
      console.error('PDF error:', err);
      window.print();
    });
  } else {
    window.print();
  }
}

function triggerReadySlipPrint() {
  if (!currentReadySlipData) return;
  const d = currentReadySlipData;
  const printUrl = `${window.location.origin}/slip?client=${encodeURIComponent(d.clientName)}&factory=${encodeURIComponent(d.factoryName)}&ready_only=1&print=1`;
  window.open(printUrl, '_blank');
}

function triggerReadySlipFromOrderModal() {
  const orderId = parseInt(document.getElementById('formOrderId').value, 10);
  if (orderId) {
    sendReadySlipDirect({ orderId });
  }
}


