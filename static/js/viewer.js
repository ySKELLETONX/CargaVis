/* viewer.js — Three.js 3D Viewer (ES Module) */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

// ── Scene ─────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1117);
scene.fog = new THREE.Fog(0x0f1117, 60, 120);

const container = document.getElementById('three-container');

const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.01, 500);
camera.position.set(12, 9, 18);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// ── Lighting ──────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 0.5));

const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(15, 25, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const fill = new THREE.DirectionalLight(0x8888ff, 0.3);
fill.position.set(-10, 5, -10);
scene.add(fill);

// ── Grid ──────────────────────────────────────────────────────────────────────
const grid = new THREE.GridHelper(100, 100, 0x333344, 0x222233);
scene.add(grid);

// ── Controls ──────────────────────────────────────────────────────────────────
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.06;
orbit.minDistance = 0.5;
orbit.maxDistance = 200;

const transform = new TransformControls(camera, renderer.domElement);
transform.addEventListener('dragging-changed', e => { orbit.enabled = !e.value; });
scene.add(transform);

// ── Raycaster ─────────────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// ── State ─────────────────────────────────────────────────────────────────────
let vehicleData   = null;
let vehicleGroup  = null;
let itemMeshes    = [];
let selectedMesh  = null;
let lastResult    = null;   // último resultado de otimização (usado ao salvar)
let lastMode      = 'auto'; // modo usado na última otimização
const productColorMap = {};
let colorIdx = 0;

const PALETTE = [
  0x4f86f7, 0xf75f5f, 0x5fcc6e, 0xf7a633,
  0xa066f7, 0x33d6f7, 0xf733a0, 0xf7e533,
  0xff8c42, 0x42c5ff, 0xff6b9d, 0x6bff9d,
];

// ── Animation loop ────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  orbit.update();
  renderer.render(scene, camera);
}
animate();

// ── Resize ────────────────────────────────────────────────────────────────────
const resizeObserver = new ResizeObserver(() => {
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
});
resizeObserver.observe(container);

// ── Vehicle rendering ─────────────────────────────────────────────────────────
function drawVehicle(v) {
  vehicleData = v;

  if (vehicleGroup) {
    scene.remove(vehicleGroup);
    vehicleGroup.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
  clearItems();

  vehicleGroup = new THREE.Group();
  // Vehicle box is centered at x=0,z=0 and its floor is at y=0
  vehicleGroup.position.set(0, v.int_height / 2, 0);
  scene.add(vehicleGroup);

  // Wireframe edges
  const geo = new THREE.BoxGeometry(v.int_width, v.int_height, v.int_length);
  const edges = new THREE.EdgesGeometry(geo);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x00e5a0, linewidth: 1 });
  vehicleGroup.add(new THREE.LineSegments(edges, lineMat));
  geo.dispose();

  // Semi-transparent shell
  const shellMat = new THREE.MeshPhongMaterial({
    color: 0x00e5a0,
    transparent: true,
    opacity: 0.04,
    side: THREE.BackSide,
  });
  const shell = new THREE.Mesh(new THREE.BoxGeometry(v.int_width, v.int_height, v.int_length), shellMat);
  vehicleGroup.add(shell);

  // Floor plane
  const floorGeo = new THREE.PlaneGeometry(v.int_width, v.int_length);
  const floorMat = new THREE.MeshPhongMaterial({ color: 0x1a2a3a, side: THREE.DoubleSide });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -v.int_height / 2 + 0.001;
  floor.receiveShadow = true;
  vehicleGroup.add(floor);

  // Fit camera
  const maxDim = Math.max(v.int_width, v.int_height, v.int_length);
  camera.position.set(maxDim * 1.4, maxDim * 1.1, maxDim * 2.0);
  const target = new THREE.Vector3(0, v.int_height / 2, 0);
  camera.lookAt(target);
  orbit.target.copy(target);
  orbit.update();

  document.getElementById('empty-state').classList.remove('d-none');
}

// ── Item rendering ────────────────────────────────────────────────────────────
function getProductColor(name) {
  if (productColorMap[name] === undefined) {
    productColorMap[name] = PALETTE[colorIdx % PALETTE.length];
    colorIdx++;
  }
  return productColorMap[name];
}

function clearItems() {
  itemMeshes.forEach(m => {
    scene.remove(m);
    m.geometry.dispose();
    m.material.dispose();
  });
  itemMeshes = [];
  transform.detach();
  selectedMesh = null;
  document.getElementById('item-info').classList.add('d-none');
  document.getElementById('transform-controls').classList.add('d-none');
}

function drawPackedItems(packedList, v) {
  clearItems();
  document.getElementById('empty-state').classList.add('d-none');

  const vw = v.int_width;
  const vh = v.int_height;
  const vl = v.int_length;

  packedList.forEach(item => {
    const [iw, ih, id_] = item.dimensions;
    const [ix, iy, iz] = item.position;

    // py3dbp gives corner position; Three.js needs center.
    // Vehicle box: x ∈ [-vw/2, vw/2], y ∈ [0, vh], z ∈ [-vl/2, vl/2]
    const tx = -vw / 2 + ix + iw / 2;
    const ty = iy + ih / 2;
    const tz = -vl / 2 + iz + id_ / 2;

    const inset = 0.008;
    const geo = new THREE.BoxGeometry(iw - inset, ih - inset, id_ - inset);
    const color = getProductColor(item.product_name);
    const mat = new THREE.MeshPhongMaterial({
      color,
      transparent: true,
      opacity: 0.82,
      shininess: 50,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(tx, ty, tz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { ...item, originalColor: color };

    // Thin edge outline
    const edgeGeo = new THREE.EdgesGeometry(geo);
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 });
    mesh.add(new THREE.LineSegments(edgeGeo, edgeMat));

    scene.add(mesh);
    itemMeshes.push(mesh);
  });
}

// ── Stats & legend ────────────────────────────────────────────────────────────
function updateStats(result) {
  document.getElementById('stat-utilization').textContent =
    `${(result.utilization * 100).toFixed(1)}%`;
  document.getElementById('stat-weight').textContent =
    `${result.weight_used} kg`;
  document.getElementById('stat-packed').textContent =
    `${result.packed.length}`;
  document.getElementById('stat-unpacked').textContent =
    `${result.unpacked.length}`;

  const ENGINE_META = {
    'py3dbp':  ['bg-success-subtle text-success', 'bi-check-circle',    'py3dbp (preciso)'],
    'ep':      ['bg-primary-subtle text-primary',  'bi-grid-3x3',        'EP 6 rotações'],
    'ffd':     ['bg-primary-subtle text-primary',  'bi-grid-3x3',        'FFD distribuído'],
    'compact': ['bg-info-subtle    text-info',     'bi-layers',          'Compacto (colunas)'],
  };
  const [cls, icon, label] = ENGINE_META[result.engine]
    ?? ['bg-secondary-subtle text-secondary', 'bi-gear', result.engine];
  const badge = document.getElementById('engine-badge');
  badge.innerHTML = `<span class="badge ${cls}" style="font-size:.7rem"><i class="bi ${icon} me-1"></i>Motor: ${label}</span>`;

  document.getElementById('stats-panel').classList.remove('d-none');

  // Legend
  const legend = document.getElementById('color-legend');
  legend.innerHTML = '';
  const seen = new Set();
  result.packed.forEach(item => {
    if (!seen.has(item.product_name)) {
      seen.add(item.product_name);
      const hex = '#' + getProductColor(item.product_name).toString(16).padStart(6, '0');
      legend.insertAdjacentHTML('beforeend', `
        <div class="d-flex align-items-center mb-1">
          <div style="width:14px;height:14px;background:${hex};border-radius:3px;flex-shrink:0;margin-right:8px;"></div>
          <small class="text-truncate">${item.product_name}</small>
        </div>`);
    }
  });
  document.getElementById('legend-panel').classList.remove('d-none');
}

// ── Mouse selection ───────────────────────────────────────────────────────────
function deselectItem() {
  if (selectedMesh) {
    selectedMesh.material.emissive.setHex(0x000000);
    selectedMesh.material.opacity = 0.82;
    selectedMesh = null;
  }
  transform.detach();
  document.getElementById('item-info').classList.add('d-none');
  document.getElementById('transform-controls').classList.add('d-none');
}
window.deselectItem = deselectItem;

renderer.domElement.addEventListener('click', e => {
  if (transform.dragging) return;

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
  pointer.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  // recursive=false: evita acertar filhos LineSegments (que não têm emissive)
  const hits = raycaster.intersectObjects(itemMeshes, false);

  if (hits.length > 0) {
    const hit = hits[0].object;
    if (hit === selectedMesh) return;

    deselectItem();
    selectedMesh = hit;
    selectedMesh.material.emissive.setHex(0x886600);
    selectedMesh.material.opacity = 1.0;
    transform.attach(selectedMesh);

    const info = selectedMesh.userData;
    document.getElementById('info-name').textContent = info.product_name;
    document.getElementById('info-pos').textContent =
      `X:${info.position[0].toFixed(2)} Y:${info.position[1].toFixed(2)} Z:${info.position[2].toFixed(2)} m`;
    document.getElementById('info-dim').textContent =
      `${info.dimensions[0].toFixed(3)} × ${info.dimensions[1].toFixed(3)} × ${info.dimensions[2].toFixed(3)} m`;
    document.getElementById('info-weight').textContent = `${info.weight} kg`;

    document.getElementById('item-info').classList.remove('d-none');
    document.getElementById('transform-controls').classList.remove('d-none');
  } else {
    deselectItem();
  }
});

// ── Transform mode ────────────────────────────────────────────────────────────
function setMode(mode) {
  transform.setMode(mode);
  document.getElementById('btn-translate').classList.toggle('active', mode === 'translate');
  document.getElementById('btn-rotate').classList.toggle('active', mode === 'rotate');
}
window.setMode = setMode;

// ── UI: load vehicles ─────────────────────────────────────────────────────────
async function loadVehicles() {
  const res = await fetch('/api/vehicles');
  const vehicles = await res.json();
  const select = document.getElementById('vehicle-select');
  select.innerHTML = '<option value="">Selecione um veículo...</option>';
  vehicles.forEach(v => {
    const opt = new Option(`${v.name} — ${v.int_length}×${v.int_width}×${v.int_height} m`, v.id);
    select.appendChild(opt);
  });
}

document.getElementById('vehicle-select').addEventListener('change', async function () {
  const id = this.value;
  if (!id) return;
  const res = await fetch(`/api/vehicles/${id}`);
  const v = await res.json();
  vehicleData = v;
  document.getElementById('vehicle-info').classList.remove('d-none');
  document.getElementById('vehicle-dims').textContent =
    `${v.int_length}×${v.int_width}×${v.int_height} m | Vol: ${v.volume} m³${v.max_weight ? ' | Máx: ' + v.max_weight + ' kg' : ''}`;
  drawVehicle(v);

  // Reset stats
  document.getElementById('stats-panel').classList.add('d-none');
  document.getElementById('legend-panel').classList.add('d-none');
  Object.keys(productColorMap).forEach(k => delete productColorMap[k]);
  colorIdx = 0;
});

// ── UI: load products ─────────────────────────────────────────────────────────
let allProducts = [];

async function loadProducts() {
  const res = await fetch('/api/products');
  allProducts = await res.json();
  renderProductList(allProducts);

  document.getElementById('product-search').addEventListener('input', function () {
    const q = this.value.trim().toLowerCase();
    const filtered = q
      ? allProducts.filter(p =>
          p.name.toLowerCase().includes(q) ||
          (p.sku && p.sku.toLowerCase().includes(q))
        )
      : allProducts;
    renderProductList(filtered, q);
  });
}

function renderProductList(products, highlight = '') {
  const list = document.getElementById('product-list');

  if (allProducts.length === 0) {
    list.innerHTML = `<p class="text-muted small">
      Nenhum produto cadastrado. <a href="/products">Cadastrar</a>
    </p>`;
    return;
  }

  if (products.length === 0) {
    list.innerHTML = `<p class="text-muted small fst-italic">Nenhum produto encontrado.</p>`;
    return;
  }

  list.innerHTML = products.map(p => {
    const nameHl  = highlight ? hlText(p.name, highlight) : esc(p.name);
    const skuHl   = p.sku && highlight ? hlText(p.sku, highlight) : (p.sku ? esc(p.sku) : '');
    const skuBadge = skuHl
      ? `<span class="badge bg-secondary-subtle text-secondary me-1" style="font-size:.65rem">${skuHl}</span>`
      : '';
    return `
    <div class="product-row d-flex align-items-center mb-2 gap-2" data-id="${p.id}">
      <div class="flex-grow-1 min-w-0">
        <div class="fw-medium small text-truncate">${skuBadge}${nameHl}</div>
        <div class="text-muted" style="font-size:.72rem">
          ${p.length}×${p.width}×${p.height}m | ${p.weight}kg
          ${p.stackable ? '' : ' <i class="bi bi-exclamation-triangle text-warning" title="Não empilhável"></i>'}
        </div>
      </div>
      <input type="number" class="form-control form-control-sm qty-input"
             style="width:68px" min="0" value="0"
             data-product-id="${p.id}" aria-label="Quantidade de ${p.name}" />
    </div>`;
  }).join('');
}

function esc(str) {
  return str.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function hlText(str, query) {
  const safe = esc(str);
  const safeQ = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(safeQ, 'gi'), m => `<mark class="p-0 rounded-1">${m}</mark>`);
}

// ── Reset quantities ──────────────────────────────────────────────────────────
function resetQuantities() {
  const search = document.getElementById('product-search');
  search.value = '';
  renderProductList(allProducts);
  document.querySelectorAll('.qty-input').forEach(inp => { inp.value = 0; });
}
window.resetQuantities = resetQuantities;

// ── Optimize ──────────────────────────────────────────────────────────────────
document.getElementById('btn-optimize').addEventListener('click', async () => {
  if (!vehicleData) {
    alert('Selecione um veículo primeiro.');
    return;
  }

  const mode = document.querySelector('input[name="pack-mode"]:checked').value;

  const items = [];
  document.querySelectorAll('.qty-input').forEach(inp => {
    const qty = parseInt(inp.value, 10);
    if (qty > 0) {
      items.push({ product_id: parseInt(inp.dataset.productId, 10), quantity: qty });
    }
  });

  if (items.length === 0) {
    alert('Informe a quantidade de ao menos um produto.');
    return;
  }

  const btn = document.getElementById('btn-optimize');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Calculando...';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch('/api/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: vehicleData.id, items, mode }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();

    lastResult = result;
    lastMode   = mode;
    document.getElementById('btn-save').removeAttribute('disabled');

    drawPackedItems(result.packed, vehicleData);
    updateStats(result);

    if (result.unpacked.length > 0) {
      const msg = `${result.unpacked.length} item(s) não couberam no veículo.`;
      showToast(msg, 'warning');
    } else {
      showToast('Todos os itens foram alocados com sucesso!', 'success');
    }
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err.name === 'AbortError'
      ? 'Tempo limite excedido (30s). Reduza a quantidade de itens ou reinicie o servidor.'
      : 'Erro ao otimizar: ' + err.message;
    showToast(msg, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-magic me-2"></i>Otimizar Carga';
  }
});

// ── Toast helper ──────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:fixed;bottom:1rem;right:1rem;z-index:9999';
  wrapper.innerHTML = `
    <div class="toast align-items-center text-bg-${type} border-0 show" role="alert">
      <div class="d-flex">
        <div class="toast-body">${message}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`;
  document.body.appendChild(wrapper);
  setTimeout(() => wrapper.remove(), 4000);
}

// ── Sessions: salvar ──────────────────────────────────────────────────────────
document.getElementById('btn-confirm-save').addEventListener('click', async () => {
  const name = document.getElementById('session-name-input').value.trim();
  const errEl = document.getElementById('save-error');
  errEl.classList.add('d-none');

  if (!name) { errEl.textContent = 'Informe um nome.'; errEl.classList.remove('d-none'); return; }
  if (!lastResult || !vehicleData) { errEl.textContent = 'Nenhum resultado para salvar.'; errEl.classList.remove('d-none'); return; }

  const btn = document.getElementById('btn-confirm-save');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Salvando...';

  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        vehicle_id:  vehicleData.id,
        mode:        lastMode,
        utilization: lastResult.utilization,
        weight_used: lastResult.weight_used,
        engine:      lastResult.engine,
        packed:      lastResult.packed,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bootstrap.Modal.getInstance(document.getElementById('saveModal')).hide();
    document.getElementById('session-name-input').value = '';
    showToast('Projeto salvo com sucesso!', 'success');
  } catch (err) {
    errEl.textContent = 'Erro ao salvar: ' + err.message;
    errEl.classList.remove('d-none');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>Salvar';
  }
});

// ── Sessions: listar ──────────────────────────────────────────────────────────
document.getElementById('sessionsModal').addEventListener('show.bs.modal', loadSessionsList);

async function loadSessionsList() {
  const listEl = document.getElementById('sessions-list');
  const countEl = document.getElementById('sessions-count');
  listEl.innerHTML = `<div class="text-center py-4 text-muted">
    <div class="spinner-border spinner-border-sm me-2"></div>Carregando...</div>`;

  try {
    const res = await fetch('/api/sessions');
    const sessions = await res.json();
    countEl.textContent = `${sessions.length} projeto(s)`;

    if (sessions.length === 0) {
      listEl.innerHTML = `<div class="text-center py-5 text-muted">
        <i class="bi bi-folder2 fs-2 d-block mb-2 opacity-25"></i>
        Nenhum projeto salvo ainda.</div>`;
      return;
    }

    const engineLabels = {
      py3dbp: 'py3dbp', compact: 'Compacto', spread: 'Distribuído',
      ffd: 'FFD', imported: 'Importado', auto: 'Auto',
    };

    listEl.innerHTML = sessions.map(s => `
      <div class="card border-0 border-bottom rounded-0 mb-0">
        <div class="card-body py-2 px-3 d-flex align-items-center gap-3">
          <div class="flex-grow-1 min-w-0">
            <div class="fw-semibold text-truncate">${esc(s.name)}</div>
            <div class="text-muted small">
              <i class="bi bi-truck me-1"></i>${esc(s.vehicle_name)}
              &nbsp;·&nbsp;
              <i class="bi bi-box me-1"></i>${s.item_count} itens
              &nbsp;·&nbsp;
              <i class="bi bi-pie-chart me-1"></i>${(s.utilization * 100).toFixed(1)}%
              &nbsp;·&nbsp;
              <span class="badge bg-secondary-subtle text-secondary">${engineLabels[s.engine] || s.engine}</span>
            </div>
            <div class="text-muted" style="font-size:.7rem">
              <i class="bi bi-calendar3 me-1"></i>${s.created_at}
            </div>
          </div>
          <div class="d-flex gap-1 flex-shrink-0">
            <button class="btn btn-primary btn-sm" onclick="loadSessionById(${s.id})" title="Carregar">
              <i class="bi bi-play-fill"></i>
            </button>
            <button class="btn btn-outline-secondary btn-sm" onclick="exportSessionById(${s.id})" title="Exportar JSON">
              <i class="bi bi-download"></i>
            </button>
            <button class="btn btn-outline-danger btn-sm" onclick="deleteSessionById(${s.id}, this)" title="Excluir">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </div>
      </div>`).join('');
  } catch (err) {
    listEl.innerHTML = `<div class="text-center py-4 text-danger">Erro ao carregar projetos.</div>`;
  }
}

// ── Sessions: carregar ────────────────────────────────────────────────────────
async function loadSessionById(id) {
  try {
    const res = await fetch(`/api/sessions/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const s = await res.json();

    // Carrega o veículo
    const vRes = await fetch(`/api/vehicles/${s.vehicle_id}`);
    if (!vRes.ok) throw new Error('Veículo não encontrado');
    const v = await vRes.json();

    drawVehicle(v);

    // Reconstrói o resultado no formato esperado por drawPackedItems/updateStats
    const result = {
      packed:      s.items,
      unpacked:    [],
      utilization: s.utilization,
      weight_used: s.weight_used,
      weight_limit: v.max_weight,
      engine:      s.engine,
    };

    lastResult = result;
    lastMode   = s.mode;
    document.getElementById('btn-save').removeAttribute('disabled');

    drawPackedItems(result.packed, v);
    updateStats(result);

    bootstrap.Modal.getInstance(document.getElementById('sessionsModal')).hide();
    showToast(`Projeto "${s.name}" carregado.`, 'info');
  } catch (err) {
    showToast('Erro ao carregar projeto: ' + err.message, 'danger');
  }
}
window.loadSessionById = loadSessionById;

// ── Sessions: excluir ─────────────────────────────────────────────────────────
async function deleteSessionById(id, btn) {
  if (!confirm('Excluir este projeto?')) return;
  btn.disabled = true;
  try {
    const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    btn.closest('.card').remove();
    const countEl = document.getElementById('sessions-count');
    const cur = parseInt(countEl.textContent) - 1;
    countEl.textContent = `${cur} projeto(s)`;
    if (cur === 0) loadSessionsList();
  } catch (err) {
    showToast('Erro ao excluir: ' + err.message, 'danger');
    btn.disabled = false;
  }
}
window.deleteSessionById = deleteSessionById;

// ── Sessions: exportar ────────────────────────────────────────────────────────
async function exportSessionById(id) {
  try {
    const res = await fetch(`/api/sessions/${id}/export`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `cargavis_${data.name.replace(/\s+/g, '_')}_${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast('Erro ao exportar: ' + err.message, 'danger');
  }
}
window.exportSessionById = exportSessionById;

// ── Sessions: importar ────────────────────────────────────────────────────────
document.getElementById('btn-import-trigger').addEventListener('click', () => {
  document.getElementById('import-file-input').click();
});

document.getElementById('import-file-input').addEventListener('change', async function () {
  const file = this.files[0];
  if (!file) return;
  this.value = '';

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    showToast('Arquivo inválido: não é um JSON válido.', 'danger');
    return;
  }

  if (!data.cargavis_version) {
    showToast('Arquivo não reconhecido como exportação do CargaVis.', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/sessions/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    showToast('Projeto importado com sucesso!', 'success');
    loadSessionsList();
  } catch (err) {
    showToast('Erro ao importar: ' + err.message, 'danger');
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  await Promise.all([loadVehicles(), loadProducts()]);
  document.getElementById('empty-state').classList.remove('d-none');
})();
