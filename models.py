from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()


class Vehicle(db.Model):
    __tablename__ = "vehicles"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    type = db.Column(db.String(50), nullable=False, default="truck")
    int_length = db.Column(db.Float, nullable=False)
    int_width = db.Column(db.Float, nullable=False)
    int_height = db.Column(db.Float, nullable=False)
    max_weight = db.Column(db.Float, nullable=True)
    door_type = db.Column(db.String(20), default="rear")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "type": self.type,
            "int_length": self.int_length,
            "int_width": self.int_width,
            "int_height": self.int_height,
            "max_weight": self.max_weight,
            "door_type": self.door_type,
            "volume": round(self.int_length * self.int_width * self.int_height, 4),
        }


class Product(db.Model):
    __tablename__ = "products"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    sku = db.Column(db.String(50), unique=True, nullable=True)
    length = db.Column(db.Float, nullable=False)
    width = db.Column(db.Float, nullable=False)
    height = db.Column(db.Float, nullable=False)
    weight = db.Column(db.Float, nullable=False)
    stackable = db.Column(db.Boolean, default=True)
    max_stack = db.Column(db.Integer, default=3)
    orientation = db.Column(db.String(20), default="any")
    fragile = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "sku": self.sku,
            "length": self.length,
            "width": self.width,
            "height": self.height,
            "weight": self.weight,
            "stackable": self.stackable,
            "max_stack": self.max_stack,
            "orientation": self.orientation,
            "fragile": self.fragile,
            "volume": round(self.length * self.width * self.height, 4),
        }


class LoadSession(db.Model):
    __tablename__ = "load_sessions"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    vehicle_id = db.Column(db.Integer, db.ForeignKey("vehicles.id"), nullable=False)
    mode = db.Column(db.String(20), default="auto")
    utilization = db.Column(db.Float, default=0)
    weight_used = db.Column(db.Float, default=0)
    engine = db.Column(db.String(20))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    vehicle = db.relationship("Vehicle", backref="sessions")
    items = db.relationship("LoadItem", backref="session", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "vehicle_id": self.vehicle_id,
            "vehicle_name": self.vehicle.name,
            "mode": self.mode,
            "utilization": self.utilization,
            "weight_used": self.weight_used,
            "engine": self.engine,
            "created_at": self.created_at.strftime("%d/%m/%Y %H:%M"),
            "item_count": len(self.items),
        }

    def to_export_dict(self):
        return {
            "cargavis_version": "1.0",
            **self.to_dict(),
            "vehicle": self.vehicle.to_dict(),
            "items": [i.to_dict() for i in self.items],
        }


class SiteStats(db.Model):
    __tablename__ = "site_stats"

    id = db.Column(db.Integer, primary_key=True)
    visits = db.Column(db.Integer, default=0, nullable=False)


class LoadItem(db.Model):
    __tablename__ = "load_items"

    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey("load_sessions.id"), nullable=False)
    product_id = db.Column(db.Integer, nullable=True)
    product_name = db.Column(db.String(100), nullable=False)
    pos_x = db.Column(db.Float)
    pos_y = db.Column(db.Float)
    pos_z = db.Column(db.Float)
    dim_x = db.Column(db.Float)
    dim_y = db.Column(db.Float)
    dim_z = db.Column(db.Float)
    weight = db.Column(db.Float)

    def to_dict(self):
        return {
            "product_id": self.product_id,
            "product_name": self.product_name,
            "position": [self.pos_x, self.pos_y, self.pos_z],
            "dimensions": [self.dim_x, self.dim_y, self.dim_z],
            "weight": self.weight,
        }
