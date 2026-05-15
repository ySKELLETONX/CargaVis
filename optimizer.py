from bisect import bisect_left, bisect_right

try:
    from py3dbp import Packer, Bin, Item
    HAS_PY3DBP = True
except ImportError:
    HAS_PY3DBP = False

PY3DBP_ITEM_LIMIT = 30


def pack_products(vehicle, items_request, mode="auto"):
    """
    vehicle       : Vehicle model instance
    items_request : list of dicts com chaves:
                    product_id, name, sku, quantity, width, height, length, weight, stackable
    mode          : "auto" | "compact" | "spread"
    Returns dict  : { packed, unpacked, utilization, weight_used, weight_limit, engine }
    """
    if mode == "compact":
        return _pack_compact(vehicle, items_request)
    if mode == "spread":
        return _pack_ep(vehicle, items_request)
    total_items = sum(e["quantity"] for e in items_request)
    if HAS_PY3DBP and total_items <= PY3DBP_ITEM_LIMIT:
        return _pack_with_py3dbp(vehicle, items_request)
    return _pack_ep(vehicle, items_request)


def _build_item_registry(items_request):
    registry = {}
    ordered = []
    for entry in items_request:
        sku = entry.get("sku") or str(entry["product_id"])
        for i in range(entry["quantity"]):
            name = f"{entry['product_id']}_{sku}_{i}"
            registry[name] = entry
            ordered.append(name)
    return registry, ordered


def _all_orientations(e, prefer_tall=False):
    """All 6 unique axis-aligned rotations of item e (width, height, depth)."""
    w, h, d = e["width"], e["height"], e["length"]
    seen, result = set(), []
    for o in [(w, h, d), (d, h, w), (h, w, d), (w, d, h), (h, d, w), (d, w, h)]:
        if o not in seen:
            seen.add(o)
            result.append(o)
    if prefer_tall:
        result.sort(key=lambda o: -o[1])
    return result


# ── Height Map ────────────────────────────────────────────────────────────────

class _HeightMap:
    """
    2D coordinate-compressed surface height map.

    Maintains a sparse grid of (X-interval × Z-interval) cells where each
    cell stores the height of the topmost surface. Initially the entire floor
    is one cell at height 0.

    Splitting: when a boundary x or z is added, the affected cell is bisected
    and both halves inherit the original height.

    Complexity:
      gravity_y : O(k)  — k = cells touched by the footprint (~2-4 on average)
      place     : O(k)  — same
    """

    __slots__ = ("_xs", "_zs", "_d")

    def __init__(self, vw, vl):
        self._xs = [0.0, float(vw)]   # X boundaries
        self._zs = [0.0, float(vl)]   # Z boundaries
        self._d  = [[0.0]]            # _d[ix][iz] = height at cell (ix, iz)

    # ── internal splits ───────────────────────────────────────────────────────

    def _sx(self, x):
        """Insert X boundary x, splitting the containing X-strip."""
        idx = bisect_left(self._xs, x)
        if idx < len(self._xs) and abs(self._xs[idx] - x) < 1e-9:
            return
        self._xs.insert(idx, x)
        src = idx - 1 if idx > 0 else 0
        self._d.insert(idx, list(self._d[src]))

    def _sz(self, z):
        """Insert Z boundary z, splitting the containing Z-strip."""
        idx = bisect_left(self._zs, z)
        if idx < len(self._zs) and abs(self._zs[idx] - z) < 1e-9:
            return
        self._zs.insert(idx, z)
        for row in self._d:
            src = idx - 1 if idx > 0 else 0
            row.insert(idx, row[src])

    # ── public API ────────────────────────────────────────────────────────────

    def gravity_y(self, x, z, w, d):
        """Height where an item with footprint [x,x+w]×[z,z+d] would settle."""
        EPS = 1e-9
        ix1 = max(0, bisect_right(self._xs, x + EPS) - 1)
        ix2 = min(len(self._d) - 1, bisect_left(self._xs, x + w - EPS) - 1)
        iz1 = max(0, bisect_right(self._zs, z + EPS) - 1)
        iz2 = min(len(self._d[0]) - 1, bisect_left(self._zs, z + d - EPS) - 1)
        if ix2 < ix1 or iz2 < iz1:
            return 0.0
        best = 0.0
        for ix in range(ix1, ix2 + 1):
            row = self._d[ix]
            for iz in range(iz1, iz2 + 1):
                if row[iz] > best:
                    best = row[iz]
        return best

    def place(self, x, z, w, d, y_top):
        """Record that the region [x,x+w]×[z,z+d] now reaches height y_top."""
        self._sx(x);     self._sx(x + w)
        self._sz(z);     self._sz(z + d)
        ix1 = bisect_left(self._xs, x)
        ix2 = bisect_left(self._xs, x + w) - 1
        iz1 = bisect_left(self._zs, z)
        iz2 = bisect_left(self._zs, z + d) - 1
        if ix2 < ix1 or iz2 < iz1:
            return
        for ix in range(ix1, ix2 + 1):
            row = self._d[ix]
            for iz in range(iz1, iz2 + 1):
                if row[iz] < y_top:
                    row[iz] = y_top


# ── Engines ───────────────────────────────────────────────────────────────────

def _pack_with_py3dbp(vehicle, items_request):
    packer = Packer()
    max_w = vehicle.max_weight if vehicle.max_weight else 999_999

    bin_ = Bin(
        name=vehicle.name,
        width=vehicle.int_width,
        height=vehicle.int_height,
        depth=vehicle.int_length,
        max_weight=max_w,
    )
    packer.add_bin(bin_)

    registry, ordered = _build_item_registry(items_request)
    ordered.sort(key=lambda n: -registry[n]["weight"])

    for name in ordered:
        entry = registry[name]
        packer.add_item(Item(
            name=name,
            width=entry["width"],
            height=entry["height"],
            depth=entry["length"],
            weight=entry["weight"],
        ))

    packer.pack()

    packed, packed_names, total_weight = [], set(), 0.0
    for item in bin_.items:
        dim  = item.get_dimension()
        info = registry[item.name]
        packed.append({
            "name":         item.name,
            "product_id":   info["product_id"],
            "product_name": info["name"],
            "position":     [float(item.position[0]), float(item.position[1]), float(item.position[2])],
            "dimensions":   [float(dim[0]), float(dim[1]), float(dim[2])],
            "weight":       info["weight"],
        })
        packed_names.add(item.name)
        total_weight += info["weight"]

    unpacked = [n for n in ordered if n not in packed_names]
    used_vol  = sum(p["dimensions"][0] * p["dimensions"][1] * p["dimensions"][2] for p in packed)
    total_vol = vehicle.int_length * vehicle.int_width * vehicle.int_height

    return {
        "packed":       packed,
        "unpacked":     unpacked,
        "utilization":  round(used_vol / total_vol, 4) if total_vol > 0 else 0,
        "weight_used":  round(total_weight, 2),
        "weight_limit": vehicle.max_weight,
        "engine":       "py3dbp",
    }


def _pack_ep(vehicle, items_request):
    """
    Extreme-Point 3D packing com gravidade, 6 rotações e height map O(k).

    Estratégia:
    - Mantém um conjunto de posições candidatas (cx, cz) no plano do piso.
    - Para cada item, testa orientações × candidatos (ordenados por Z, X).
    - Gravidade via _HeightMap.gravity_y: O(k) — elimina checagem O(n).
    - Sem checagem de colisão separada: o height map garante posicionamento
      sempre acima de itens existentes.
    - Ordem por peso decrescente garante itens pesados na base.

    Complexidade: O(n² log n) no pior caso, ~O(n log n) na prática.
    """
    vw = vehicle.int_width
    vh = vehicle.int_height
    vl = vehicle.int_length

    registry, ordered = _build_item_registry(items_request)
    ordered.sort(key=lambda n: (
        -registry[n]["weight"],
        -(registry[n]["width"] * registry[n]["height"] * registry[n]["length"]),
    ))

    EPS = 1e-6
    hm  = _HeightMap(vw, vl)
    packed, unpacked = [], []
    total_weight = 0.0

    cand_set = {(0.0, 0.0)}
    cand_xz  = [(0.0, 0.0)]

    for name in ordered:
        e = registry[name]
        best       = None
        best_score = None

        # Sort candidates: prefer low Z then low X (front-to-back, left-to-right)
        for cx, cz in sorted(cand_xz, key=lambda c: (c[1], c[0])):

            # Early termination: already found a floor-level (Y=0) placement
            # and current candidate can only give equal-or-worse (Z, X) score.
            if best_score is not None and best_score[0] < EPS:
                if cz > best_score[1] + EPS:
                    break
                if abs(cz - best_score[1]) < EPS and cx > best_score[2] + EPS:
                    break

            for w, h, d in _all_orientations(e):
                if cx + w > vw + EPS or cz + d > vl + EPS:
                    continue
                y = hm.gravity_y(cx, cz, w, d)
                if y + h > vh + EPS:
                    continue
                score = (round(y, 4), round(cz, 4), round(cx, 4))
                if best_score is None or score < best_score:
                    best       = (cx, y, cz, w, h, d)
                    best_score = score

        if best is None:
            unpacked.append(name)
            continue

        x, y, z, w, h, d = best
        hm.place(x, z, w, d, y + h)

        for c in ((x + w, z), (x, z + d)):
            if c not in cand_set and c[0] <= vw + EPS and c[1] <= vl + EPS:
                cand_set.add(c)
                cand_xz.append(c)

        packed.append({
            "name":         name,
            "product_id":   e["product_id"],
            "product_name": e["name"],
            "position":     [round(x, 4), round(y, 4), round(z, 4)],
            "dimensions":   [round(w, 4), round(h, 4), round(d, 4)],
            "weight":       e["weight"],
        })
        total_weight += e["weight"]

    used_vol  = sum(p["dimensions"][0] * p["dimensions"][1] * p["dimensions"][2] for p in packed)
    total_vol = vw * vh * vl

    return {
        "packed":       packed,
        "unpacked":     unpacked,
        "utilization":  round(used_vol / total_vol, 4) if total_vol > 0 else 0,
        "weight_used":  round(total_weight, 2),
        "weight_limit": vehicle.max_weight,
        "engine":       "ep",
    }


def _pack_compact(vehicle, items_request):
    """
    Empacotamento compacto por colunas verticais com 6 rotações.

    Preenche Y (altura) antes de avançar em X e Z:
      1. Empilha na coluna existente mais rasa (pesado embaixo, leve em cima).
      2. Nova coluna na fileira atual.
      3. Nova fileira.
    """
    vw, vh, vl = vehicle.int_width, vehicle.int_height, vehicle.int_length

    registry, ordered = _build_item_registry(items_request)
    ordered.sort(key=lambda n: (-registry[n]["weight"], -registry[n]["height"]))

    EPS = 1e-6
    packed, unpacked = [], []
    total_weight = 0.0

    # cols: [cx, cz, col_w, col_d, top_y, min_weight_in_col]
    cols      = []
    row_z     = 0.0
    row_depth = 0.0
    next_x    = 0.0

    for name in ordered:
        e      = registry[name]
        placed = False
        px = py = pz = w = h = d = 0.0

        for w, h, d in _all_orientations(e, prefer_tall=True):
            if w > vw + EPS or h > vh + EPS or d > vl + EPS:
                continue

            # Priority 1: stack in existing column
            best_col, best_top = None, float("inf")
            for col in cols:
                _, _, cw, cd, top, col_min_w = col
                if (w <= cw + EPS and d <= cd + EPS
                        and top + h <= vh + EPS
                        and e["weight"] <= col_min_w + EPS):
                    if top < best_top:
                        best_top, best_col = top, col
            if best_col is not None:
                px, py, pz = best_col[0], best_col[4], best_col[1]
                best_col[4] += h
                best_col[5]  = e["weight"]
                placed = True
                break

            # Priority 2: new column in current row
            if next_x + w <= vw + EPS and row_z + d <= vl + EPS:
                px, py, pz = next_x, 0.0, row_z
                cols.append([next_x, row_z, w, d, h, e["weight"]])
                next_x    += w
                row_depth  = max(row_depth, d)
                placed = True
                break

            # Priority 3: advance to next row
            new_z = row_z + (row_depth if row_depth > 0 else d)
            if new_z + d <= vl + EPS and w <= vw + EPS:
                row_z     = new_z
                row_depth = d
                next_x    = 0.0
                px, py, pz = 0.0, 0.0, row_z
                cols.append([0.0, row_z, w, d, h, e["weight"]])
                next_x = w
                placed = True
                break

        if not placed:
            unpacked.append(name)
            continue

        packed.append({
            "name":         name,
            "product_id":   e["product_id"],
            "product_name": e["name"],
            "position":     [round(px, 4), round(py, 4), round(pz, 4)],
            "dimensions":   [round(w, 4),  round(h, 4),  round(d, 4)],
            "weight":       e["weight"],
        })
        total_weight += e["weight"]

    used_vol  = sum(p["dimensions"][0] * p["dimensions"][1] * p["dimensions"][2] for p in packed)
    total_vol = vl * vw * vh

    return {
        "packed":       packed,
        "unpacked":     unpacked,
        "utilization":  round(used_vol / total_vol, 4) if total_vol > 0 else 0,
        "weight_used":  round(total_weight, 2),
        "weight_limit": vehicle.max_weight,
        "engine":       "compact",
    }
