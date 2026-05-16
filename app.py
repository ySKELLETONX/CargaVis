from flask import Flask, jsonify, request, render_template
from models import db, Vehicle, Product, LoadSession, LoadItem, SiteStats
from optimizer import pack_products
from sqlalchemy.exc import IntegrityError

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:////data/cargavis.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db.init_app(app)

with app.app_context():
    db.create_all()

    if Vehicle.query.count() == 0:
        db.session.add_all([
            Vehicle(name="Fiorino / Kombi",      type="van",   int_length=1.8,  int_width=1.2,  int_height=1.2,  max_weight=650,   door_type="rear"),
            Vehicle(name="Caminhão 3/4",          type="truck", int_length=4.2,  int_width=2.2,  int_height=2.2,  max_weight=3500,  door_type="rear"),
            Vehicle(name="Truck Baú (Toco)",      type="truck", int_length=7.5,  int_width=2.4,  int_height=2.5,  max_weight=8000,  door_type="rear"),
        ])

    if Product.query.count() == 0:
        db.session.add_all([
            Product(name="Caixa Pequena",   sku="CX-P", length=0.40, width=0.30, height=0.30, weight=5.0,  stackable=True,  max_stack=5, fragile=False),
            Product(name="Caixa Média",     sku="CX-M", length=0.60, width=0.40, height=0.40, weight=12.0, stackable=True,  max_stack=3, fragile=False),
            Product(name="Caixa Grande",    sku="CX-G", length=0.80, width=0.60, height=0.60, weight=25.0, stackable=True,  max_stack=2, fragile=False),
            Product(name="Palete Padrão",   sku="PAL",  length=1.20, width=1.00, height=1.20, weight=80.0, stackable=False, max_stack=1, fragile=False),
            Product(name="Embalagem Frágil",sku="FRG",  length=0.50, width=0.40, height=0.35, weight=8.0,  stackable=False, max_stack=1, fragile=True),
        ])

    if SiteStats.query.get(1) is None:
        db.session.add(SiteStats(id=1, visits=0))

    db.session.commit()


# ── Pages ──────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    stats = SiteStats.query.get(1)
    stats.visits += 1
    db.session.commit()
    return render_template("index.html")


@app.route("/vehicles")
def vehicles_page():
    return render_template("vehicles.html")


@app.route("/products")
def products_page():
    return render_template("products.html")


@app.route("/viewer")
def viewer_page():
    return render_template("viewer.html")


@app.route("/badge/visits")
def visits_badge():
    from flask import Response
    stats = SiteStats.query.get(1)
    count = stats.visits if stats else 0
    label = "visitantes"
    value = str(count)
    lw = 90
    vw = max(40, len(value) * 9 + 16)
    tw = lw + vw
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{tw}" height="20">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="{tw}" height="20" rx="3"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="{lw}" height="20" fill="#555"/>
    <rect x="{lw}" width="{vw}" height="20" fill="#2196f3"/>
    <rect width="{tw}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,sans-serif" font-size="11">
    <text x="{lw//2}" y="15" fill="#010101" fill-opacity=".3">{label}</text>
    <text x="{lw//2}" y="14">{label}</text>
    <text x="{lw + vw//2}" y="15" fill="#010101" fill-opacity=".3">{value}</text>
    <text x="{lw + vw//2}" y="14">{value}</text>
  </g>
</svg>"""
    return Response(svg, mimetype="image/svg+xml",
                    headers={"Cache-Control": "no-cache, no-store, must-revalidate"})


# ── Vehicles API ───────────────────────────────────────────────────────────────

@app.route("/api/vehicles", methods=["GET"])
def list_vehicles():
    return jsonify([v.to_dict() for v in Vehicle.query.order_by(Vehicle.name).all()])


@app.route("/api/vehicles", methods=["POST"])
def create_vehicle():
    d = request.json
    v = Vehicle(
        name=d["name"].strip(),
        type=d.get("type", "truck"),
        int_length=float(d["int_length"]),
        int_width=float(d["int_width"]),
        int_height=float(d["int_height"]),
        max_weight=float(d["max_weight"]) if d.get("max_weight") else None,
        door_type=d.get("door_type", "rear"),
    )
    db.session.add(v)
    db.session.commit()
    return jsonify(v.to_dict()), 201


@app.route("/api/vehicles/<int:vid>", methods=["GET"])
def get_vehicle(vid):
    return jsonify(Vehicle.query.get_or_404(vid).to_dict())


@app.route("/api/vehicles/<int:vid>", methods=["PUT"])
def update_vehicle(vid):
    v = Vehicle.query.get_or_404(vid)
    d = request.json
    for field in ("name", "type", "int_length", "int_width", "int_height", "max_weight", "door_type"):
        if field in d:
            setattr(v, field, d[field])
    db.session.commit()
    return jsonify(v.to_dict())


@app.route("/api/vehicles/<int:vid>", methods=["DELETE"])
def delete_vehicle(vid):
    v = Vehicle.query.get_or_404(vid)
    db.session.delete(v)
    db.session.commit()
    return "", 204


# ── Products API ───────────────────────────────────────────────────────────────

@app.route("/api/products", methods=["GET"])
def list_products():
    return jsonify([p.to_dict() for p in Product.query.order_by(Product.name).all()])


@app.route("/api/products", methods=["POST"])
def create_product():
    d = request.json
    sku = (d.get("sku") or "").strip() or None
    p = Product(
        name=d["name"].strip(),
        sku=sku,
        length=float(d["length"]),
        width=float(d["width"]),
        height=float(d["height"]),
        weight=float(d["weight"]),
        stackable=bool(d.get("stackable", True)),
        max_stack=int(d.get("max_stack", 3)),
        orientation=d.get("orientation", "any"),
        fragile=bool(d.get("fragile", False)),
    )
    try:
        db.session.add(p)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "SKU já cadastrado"}), 409
    return jsonify(p.to_dict()), 201


@app.route("/api/products/<int:pid>", methods=["GET"])
def get_product(pid):
    return jsonify(Product.query.get_or_404(pid).to_dict())


@app.route("/api/products/<int:pid>", methods=["PUT"])
def update_product(pid):
    p = Product.query.get_or_404(pid)
    d = request.json
    if "sku" in d:
        d["sku"] = (d["sku"] or "").strip() or None
    for field in ("name", "sku", "length", "width", "height", "weight",
                  "stackable", "max_stack", "orientation", "fragile"):
        if field in d:
            setattr(p, field, d[field])
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "SKU já cadastrado"}), 409
    return jsonify(p.to_dict())


@app.route("/api/products/<int:pid>", methods=["DELETE"])
def delete_product(pid):
    p = Product.query.get_or_404(pid)
    db.session.delete(p)
    db.session.commit()
    return "", 204


# ── Optimize API ───────────────────────────────────────────────────────────────

@app.route("/api/optimize", methods=["POST"])
def optimize():
    d = request.json
    vehicle = Vehicle.query.get_or_404(d["vehicle_id"])

    resolved = []
    for entry in d.get("items", []):
        p = Product.query.get_or_404(entry["product_id"])
        resolved.append(
            {
                "product_id": p.id,
                "name": p.name,
                "sku": p.sku or p.name,
                "quantity": int(entry["quantity"]),
                "width": p.width,
                "height": p.height,
                "length": p.length,
                "weight": p.weight,
                "stackable": p.stackable,
            }
        )

    mode = d.get("mode", "auto")  # "auto" | "compact" | "spread"
    result = pack_products(vehicle, resolved, mode=mode)
    return jsonify(result)


# ── Stats API ──────────────────────────────────────────────────────────────────

@app.route("/api/stats")
def stats():
    return jsonify(
        {
            "vehicles": Vehicle.query.count(),
            "products": Product.query.count(),
        }
    )


# ── Sessions API ───────────────────────────────────────────────────────────────

@app.route("/api/sessions", methods=["GET"])
def list_sessions():
    sessions = LoadSession.query.order_by(LoadSession.created_at.desc()).all()
    return jsonify([s.to_dict() for s in sessions])


@app.route("/api/sessions", methods=["POST"])
def save_session():
    d = request.json
    vehicle = Vehicle.query.get_or_404(d["vehicle_id"])

    s = LoadSession(
        name=d["name"].strip(),
        vehicle_id=vehicle.id,
        mode=d.get("mode", "auto"),
        utilization=d.get("utilization", 0),
        weight_used=d.get("weight_used", 0),
        engine=d.get("engine", ""),
    )
    db.session.add(s)
    db.session.flush()

    for item in d.get("packed", []):
        db.session.add(LoadItem(
            session_id=s.id,
            product_id=item.get("product_id"),
            product_name=item["product_name"],
            pos_x=item["position"][0],
            pos_y=item["position"][1],
            pos_z=item["position"][2],
            dim_x=item["dimensions"][0],
            dim_y=item["dimensions"][1],
            dim_z=item["dimensions"][2],
            weight=item["weight"],
        ))

    db.session.commit()
    return jsonify(s.to_dict()), 201


@app.route("/api/sessions/<int:sid>", methods=["GET"])
def get_session(sid):
    return jsonify(LoadSession.query.get_or_404(sid).to_export_dict())


@app.route("/api/sessions/<int:sid>", methods=["DELETE"])
def delete_session(sid):
    s = LoadSession.query.get_or_404(sid)
    db.session.delete(s)
    db.session.commit()
    return "", 204


@app.route("/api/sessions/<int:sid>/export")
def export_session(sid):
    from flask import make_response
    import json
    s = LoadSession.query.get_or_404(sid)
    data = json.dumps(s.to_export_dict(), ensure_ascii=False, indent=2)
    resp = make_response(data)
    resp.headers["Content-Type"] = "application/json"
    resp.headers["Content-Disposition"] = (
        f'attachment; filename="cargavis_{s.name.replace(" ", "_")}_{s.id}.json"'
    )
    return resp


@app.route("/api/sessions/import", methods=["POST"])
def import_session():
    d = request.json

    # Tenta encontrar o veículo pelo ID, depois pelo nome; cria se não existir.
    vehicle = Vehicle.query.get(d.get("vehicle_id"))
    if not vehicle and "vehicle" in d:
        snap = d["vehicle"]
        vehicle = Vehicle.query.filter_by(name=snap["name"]).first()
        if not vehicle:
            vehicle = Vehicle(
                name=snap["name"],
                type=snap.get("type", "truck"),
                int_length=snap["int_length"],
                int_width=snap["int_width"],
                int_height=snap["int_height"],
                max_weight=snap.get("max_weight"),
                door_type=snap.get("door_type", "rear"),
            )
            db.session.add(vehicle)
            db.session.flush()

    if not vehicle:
        return jsonify({"error": "Veículo não encontrado e sem dados para criá-lo."}), 422

    s = LoadSession(
        name=d.get("name", "Sessão importada"),
        vehicle_id=vehicle.id,
        mode=d.get("mode", "auto"),
        utilization=d.get("utilization", 0),
        weight_used=d.get("weight_used", 0),
        engine=d.get("engine", "imported"),
    )
    db.session.add(s)
    db.session.flush()

    for item in d.get("items", []):
        db.session.add(LoadItem(
            session_id=s.id,
            product_id=item.get("product_id"),
            product_name=item["product_name"],
            pos_x=item["position"][0],
            pos_y=item["position"][1],
            pos_z=item["position"][2],
            dim_x=item["dimensions"][0],
            dim_y=item["dimensions"][1],
            dim_z=item["dimensions"][2],
            weight=item["weight"],
        ))

    db.session.commit()
    return jsonify(s.to_dict()), 201


if __name__ == "__main__":
    app.run(debug=True)
