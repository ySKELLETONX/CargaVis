# CargaVis

**Otimizador de carregamento 3D para veículos — gratuito e open source.**

CargaVis resolve o problema de bin packing 3D para logística: dado um veículo e uma lista de produtos, calcula automaticamente a melhor disposição das caixas, visualiza o resultado em 3D interativo e exporta o plano de carga.

![Python](https://img.shields.io/badge/Python-3.10%2B-blue?logo=python)
![Flask](https://img.shields.io/badge/Flask-3.0-lightgrey?logo=flask)
![Three.js](https://img.shields.io/badge/Three.js-r165-black?logo=threedotjs)
![License](https://img.shields.io/badge/license-MIT-green)

**Demo ao vivo:** [https://cargavis.fly.dev](https://cargavis.fly.dev)

---

## Funcionalidades

- **Visualizador 3D interativo** — Three.js com rotação, zoom, pan e seleção de itens por clique
- **3 modos de empacotamento:**
  - *Automático* — py3dbp para cargas pequenas (≤ 30 itens), Extreme Points para cargas grandes
  - *Compacto* — empilha na entrada do veículo, deixa comprimento livre
  - *Distribuído* — preenche todo o volume com gravidade simulada
- **6 rotações por caixa** — o algoritmo testa todas as orientações possíveis
- **Height map com coordenadas comprimidas** — O(n log n) na prática; suporta 600+ itens em < 1 segundo
- **Pesado embaixo, leve em cima** — restrição de peso respeitada em todos os modos
- **CRUD de veículos e produtos** via interface web
- **Salvar / carregar projetos** no banco local
- **Exportar / importar** planos de carga como JSON

---

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | Python 3.10+, Flask 3, SQLAlchemy |
| Banco | SQLite (via SQLAlchemy) |
| Frontend | Bootstrap 5, Bootstrap Icons |
| 3D | Three.js r165 (ES Modules via CDN) |
| Algoritmo | py3dbp, Extreme Points + Height Map próprio |

---

## Como rodar localmente

### Pré-requisitos

- Python 3.10 ou superior
- pip

### Instalação

```bash
# Clone o repositório
git clone https://github.com/SEU_USUARIO/cargavis.git
cd cargavis

# Crie e ative o ambiente virtual
python -m venv .venv

# Windows
.venv\Scripts\activate

# Linux / macOS
source .venv/bin/activate

# Instale as dependências
pip install -r requirements.txt
```

### Executar

```bash
python app.py
```

Acesse `http://localhost:5000` no navegador.

O banco `cargavis.db` é criado automaticamente na primeira execução.

---

## Estrutura do projeto

```
cargavis/
├── app.py              # Flask — rotas de página e API REST
├── models.py           # SQLAlchemy — Vehicle, Product, LoadSession, LoadItem
├── optimizer.py        # Algoritmos de bin packing 3D
├── requirements.txt
├── static/
│   ├── css/custom.css
│   └── js/
│       ├── viewer.js   # Three.js — visualizador e lógica da UI
│       ├── vehicles.js
│       └── products.js
└── templates/
    ├── base.html
    ├── index.html
    ├── viewer.html
    ├── vehicles.html
    └── products.html
```

---

## API REST

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/vehicles` | Lista veículos |
| POST | `/api/vehicles` | Cria veículo |
| PUT | `/api/vehicles/<id>` | Atualiza veículo |
| DELETE | `/api/vehicles/<id>` | Remove veículo |
| GET | `/api/products` | Lista produtos |
| POST | `/api/products` | Cria produto |
| PUT | `/api/products/<id>` | Atualiza produto |
| DELETE | `/api/products/<id>` | Remove produto |
| POST | `/api/optimize` | Otimiza carga |
| GET | `/api/sessions` | Lista projetos salvos |
| POST | `/api/sessions` | Salva projeto |
| GET | `/api/sessions/<id>` | Detalha projeto |
| DELETE | `/api/sessions/<id>` | Remove projeto |
| GET | `/api/sessions/<id>/export` | Exporta projeto como JSON |
| POST | `/api/sessions/import` | Importa projeto de JSON |

### Exemplo — otimizar carga

```bash
curl -X POST http://localhost:5000/api/optimize \
  -H "Content-Type: application/json" \
  -d '{
    "vehicle_id": 1,
    "mode": "auto",
    "items": [
      { "product_id": 1, "quantity": 10 },
      { "product_id": 2, "quantity": 5 }
    ]
  }'
```

Resposta:

```json
{
  "engine": "ep",
  "utilization": 0.742,
  "weight_used": 320.5,
  "weight_limit": 5000,
  "packed": [
    {
      "product_id": 1,
      "product_name": "Caixa A",
      "position": [0.0, 0.0, 0.0],
      "dimensions": [0.6, 0.4, 0.8],
      "weight": 12.5
    }
  ],
  "unpacked": []
}
```

---

## Algoritmo de otimização

### Extreme Points + Height Map (`optimizer.py`)

O modo principal (`auto` / `spread`) usa **Extreme Points com gravidade**:

1. Mantém um conjunto de posições candidatas `(cx, cz)` no plano do piso.
2. Para cada item (ordenado por peso decrescente), testa todas as **6 rotações** em todos os candidatos.
3. **Gravidade**: projeta o item para baixo via `_HeightMap.gravity_y()` — encontra o Y mais alto que o suporta sem colisão.
4. Escolhe a melhor posição pelo critério `(Y mínimo, Z mínimo, X mínimo)`.
5. Adiciona as bordas do item colocado como novos candidatos.

O `_HeightMap` usa **compressão de coordenadas** (grid esparso): os limites do grid são exatamente as bordas dos itens já colocados. Queries de gravidade e atualizações são **O(k)** onde k é o número de células tocadas pelo footprint (tipicamente 2–4).

**Complexidade:** O(n² log n) no pior caso, O(n log n) na prática com terminação antecipada.
**Benchmark:** 600 itens em < 1 segundo.

### Modo Compacto

Algoritmo de colunas verticais com 6 rotações e preferência por orientações mais altas. Preenche altura antes de avançar em X e Z, garantindo que o restante do comprimento do veículo fique livre.

---

## Licença

MIT — use, modifique e distribua livremente. Veja [LICENSE](LICENSE).

---
