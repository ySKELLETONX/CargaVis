/* vehicles.js — CRUD de Veículos */

let vehicles = [];
let deleteId = null;
const modal = () => bootstrap.Modal.getOrCreate(document.getElementById('vehicleModal'));
const delModal = () => bootstrap.Modal.getOrCreate(document.getElementById('deleteModal'));

// ── Volume preview ──────────────────────────────────────────────────────────
['v-length', 'v-width', 'v-height'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateVolumePreview);
});

function updateVolumePreview() {
  const l = parseFloat(document.getElementById('v-length').value) || 0;
  const w = parseFloat(document.getElementById('v-width').value) || 0;
  const h = parseFloat(document.getElementById('v-height').value) || 0;
  const vol = l * w * h;
  document.getElementById('volume-preview').textContent =
    vol > 0 ? `Volume: ${vol.toFixed(3)} m³` : 'Volume: — m³';
}

// ── Load vehicles ────────────────────────────────────────────────────────────
async function loadVehicles() {
  const res = await fetch('/api/vehicles');
  vehicles = await res.json();
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('vehicles-tbody');
  if (vehicles.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="7" class="text-center py-5 text-muted">
        <i class="bi bi-truck fs-2 d-block mb-2 opacity-25"></i>
        Nenhum veículo cadastrado.
        <a href="#" class="d-block mt-1" data-bs-toggle="modal" data-bs-target="#vehicleModal" onclick="openNew()">Cadastrar primeiro veículo</a>
      </td></tr>`;
    return;
  }

  const typeLabels = { truck: 'Caminhão', van: 'Van', trailer: 'Trailer', pickup: 'Pickup', other: 'Outro' };
  const doorLabels = { rear: 'Traseira', side: 'Lateral', both: 'Ambas' };

  tbody.innerHTML = vehicles.map(v => `
    <tr>
      <td class="ps-4 fw-medium">${v.name}</td>
      <td><span class="badge bg-secondary">${typeLabels[v.type] || v.type}</span></td>
      <td class="text-muted">${v.int_length} × ${v.int_width} × ${v.int_height}</td>
      <td>${v.volume} m³</td>
      <td>${v.max_weight ? v.max_weight + ' kg' : '<span class="text-muted">—</span>'}</td>
      <td>${doorLabels[v.door_type] || v.door_type}</td>
      <td class="pe-4 text-end">
        <button class="btn btn-outline-primary btn-sm me-1" onclick="openEdit(${v.id})">
          <i class="bi bi-pencil"></i>
        </button>
        <button class="btn btn-outline-danger btn-sm" onclick="openDelete(${v.id}, '${v.name.replace(/'/g, "\\'")}')">
          <i class="bi bi-trash"></i>
        </button>
      </td>
    </tr>`).join('');
}

// ── Open new / edit ──────────────────────────────────────────────────────────
function openNew() {
  document.getElementById('modal-title').textContent = 'Novo Veículo';
  document.getElementById('vehicle-form').reset();
  document.getElementById('v-id').value = '';
  document.getElementById('volume-preview').textContent = 'Volume: — m³';
  hideError('v-error');
}

function openEdit(id) {
  const v = vehicles.find(x => x.id === id);
  if (!v) return;
  document.getElementById('modal-title').textContent = 'Editar Veículo';
  document.getElementById('v-id').value = v.id;
  document.getElementById('v-name').value = v.name;
  document.getElementById('v-type').value = v.type;
  document.getElementById('v-door').value = v.door_type;
  document.getElementById('v-length').value = v.int_length;
  document.getElementById('v-width').value = v.int_width;
  document.getElementById('v-height').value = v.int_height;
  document.getElementById('v-maxweight').value = v.max_weight || '';
  updateVolumePreview();
  hideError('v-error');
  modal().show();
}

// ── Save ─────────────────────────────────────────────────────────────────────
async function saveVehicle() {
  const id = document.getElementById('v-id').value;
  const payload = {
    name: document.getElementById('v-name').value.trim(),
    type: document.getElementById('v-type').value,
    door_type: document.getElementById('v-door').value,
    int_length: document.getElementById('v-length').value,
    int_width: document.getElementById('v-width').value,
    int_height: document.getElementById('v-height').value,
    max_weight: document.getElementById('v-maxweight').value,
  };

  if (!payload.name || !payload.int_length || !payload.int_width || !payload.int_height) {
    showError('v-error', 'Preencha todos os campos obrigatórios.');
    return;
  }

  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/vehicles/${id}` : '/api/vehicles';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json();
    showError('v-error', err.error || 'Erro ao salvar.');
    return;
  }

  modal().hide();
  await loadVehicles();
}

// ── Delete ───────────────────────────────────────────────────────────────────
function openDelete(id, name) {
  deleteId = id;
  document.getElementById('del-name').textContent = name;
  delModal().show();
}

async function confirmDelete() {
  if (!deleteId) return;
  await fetch(`/api/vehicles/${deleteId}`, { method: 'DELETE' });
  delModal().hide();
  deleteId = null;
  await loadVehicles();
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.remove('d-none');
}
function hideError(id) {
  document.getElementById(id).classList.add('d-none');
}

loadVehicles();
