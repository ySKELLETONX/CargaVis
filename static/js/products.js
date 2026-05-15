/* products.js — CRUD de Produtos */

let products = [];
let deleteId = null;
const modal = () => bootstrap.Modal.getOrCreate(document.getElementById('productModal'));
const delModal = () => bootstrap.Modal.getOrCreate(document.getElementById('deleteModal'));

// ── Volume preview ──────────────────────────────────────────────────────────
['p-length', 'p-width', 'p-height'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateVolPreview);
});

function updateVolPreview() {
  const l = parseFloat(document.getElementById('p-length').value) || 0;
  const w = parseFloat(document.getElementById('p-width').value) || 0;
  const h = parseFloat(document.getElementById('p-height').value) || 0;
  const vol = l * w * h;
  document.getElementById('p-vol-preview').textContent =
    vol > 0 ? `Volume: ${vol.toFixed(4)} m³` : 'Volume: — m³';
}

// ── Load products ────────────────────────────────────────────────────────────
async function loadProducts() {
  const res = await fetch('/api/products');
  products = await res.json();
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('products-tbody');
  if (products.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="7" class="text-center py-5 text-muted">
        <i class="bi bi-box-seam fs-2 d-block mb-2 opacity-25"></i>
        Nenhum produto cadastrado.
        <a href="#" class="d-block mt-1" data-bs-toggle="modal" data-bs-target="#productModal" onclick="openNew()">Cadastrar primeiro produto</a>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = products.map(p => `
    <tr>
      <td class="ps-4">
        <div class="fw-medium">${p.name}</div>
        ${p.sku ? `<small class="text-muted">${p.sku}</small>` : ''}
      </td>
      <td class="text-muted">${p.length} × ${p.width} × ${p.height}</td>
      <td>${p.volume} m³</td>
      <td>${p.weight} kg</td>
      <td>
        ${p.stackable
          ? `<span class="badge bg-success-subtle text-success">Sim (máx. ${p.max_stack})</span>`
          : `<span class="badge bg-secondary-subtle text-secondary">Não</span>`}
      </td>
      <td>
        ${p.fragile
          ? `<span class="badge bg-danger-subtle text-danger"><i class="bi bi-exclamation-triangle me-1"></i>Sim</span>`
          : `<span class="text-muted">—</span>`}
      </td>
      <td class="pe-4 text-end">
        <button class="btn btn-outline-primary btn-sm me-1" onclick="openEdit(${p.id})">
          <i class="bi bi-pencil"></i>
        </button>
        <button class="btn btn-outline-danger btn-sm" onclick="openDelete(${p.id}, '${p.name.replace(/'/g, "\\'")}')">
          <i class="bi bi-trash"></i>
        </button>
      </td>
    </tr>`).join('');
}

// ── Open new / edit ──────────────────────────────────────────────────────────
function openNew() {
  document.getElementById('modal-title').textContent = 'Novo Produto';
  document.getElementById('product-form').reset();
  document.getElementById('p-id').value = '';
  document.getElementById('p-stackable').checked = true;
  document.getElementById('p-maxstack').value = 3;
  document.getElementById('p-vol-preview').textContent = 'Volume: — m³';
  hideError('p-error');
}

function openEdit(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  document.getElementById('modal-title').textContent = 'Editar Produto';
  document.getElementById('p-id').value = p.id;
  document.getElementById('p-name').value = p.name;
  document.getElementById('p-sku').value = p.sku || '';
  document.getElementById('p-orientation').value = p.orientation;
  document.getElementById('p-length').value = p.length;
  document.getElementById('p-width').value = p.width;
  document.getElementById('p-height').value = p.height;
  document.getElementById('p-weight').value = p.weight;
  document.getElementById('p-stackable').checked = p.stackable;
  document.getElementById('p-maxstack').value = p.max_stack;
  document.getElementById('p-fragile').checked = p.fragile;
  updateVolPreview();
  hideError('p-error');
  modal().show();
}

// ── Save ─────────────────────────────────────────────────────────────────────
async function saveProduct() {
  const id = document.getElementById('p-id').value;
  const payload = {
    name: document.getElementById('p-name').value.trim(),
    sku: document.getElementById('p-sku').value.trim(),
    orientation: document.getElementById('p-orientation').value,
    length: document.getElementById('p-length').value,
    width: document.getElementById('p-width').value,
    height: document.getElementById('p-height').value,
    weight: document.getElementById('p-weight').value,
    stackable: document.getElementById('p-stackable').checked,
    max_stack: document.getElementById('p-maxstack').value,
    fragile: document.getElementById('p-fragile').checked,
  };

  if (!payload.name || !payload.length || !payload.width || !payload.height || !payload.weight) {
    showError('p-error', 'Preencha todos os campos obrigatórios.');
    return;
  }

  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/products/${id}` : '/api/products';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json();
    showError('p-error', err.error || 'Erro ao salvar.');
    return;
  }

  modal().hide();
  await loadProducts();
}

// ── Delete ───────────────────────────────────────────────────────────────────
function openDelete(id, name) {
  deleteId = id;
  document.getElementById('del-name').textContent = name;
  delModal().show();
}

async function confirmDelete() {
  if (!deleteId) return;
  await fetch(`/api/products/${deleteId}`, { method: 'DELETE' });
  delModal().hide();
  deleteId = null;
  await loadProducts();
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

loadProducts();
