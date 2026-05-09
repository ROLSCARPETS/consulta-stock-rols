# Consulta de Stock Rols

App web local para consultar el stock de alfombras y moquetas de Rols
Carpets. Levanta un servidor Flask en `http://localhost:5000` con un panel
tipo Rols: sidebar de navegación, búsqueda guiada por formulario y chat en
lenguaje natural con tabla de resultados.

## Características

- Búsqueda guiada por **referencia + ancho + largo**, con validación de
  colección.
- Chat en lenguaje natural (ej. *"quiero 4x3 metros de Diana Herringbone
  Denim"*) con detección de ambigüedad de color.
- Consulta combinada de **stock terminado** y **piezas en fabricación**
  (con fecha estimada de disponibilidad).
- Sugerencia automática de **alternativas** (Tier I / Tier II) cuando no
  hay stock ni fabricación disponibles.

## Requisitos

- Windows con **Python 3.9+** instalado y en el `PATH`.
- Conexión a internet la primera vez (instala dependencias automáticamente).

Dependencias Python: `flask`, `openpyxl`. Se instalan solas la primera
vez que se ejecuta el `.bat` (ver abajo).

## Cómo arrancar la app

### Opción 1 — Doble clic (recomendada)

Doble clic en:

```
Consulta de Stock Rols Agente/Iniciar Consulta de Stock.bat
```

El `.bat` comprueba Python, instala Flask y openpyxl si faltan, arranca
el servidor y abre el navegador en `http://localhost:5000`.

### Opción 2 — Manual

```powershell
cd "Consulta de Stock Rols Agente/consulta-stock-rols"
pip install flask openpyxl
python app.py
```

Luego abre `http://localhost:5000` en el navegador.

## Estructura del proyecto

```
Consulta de Stock Rols Agente/
├── Iniciar Consulta de Stock.bat   # Lanzador para Windows
└── consulta-stock-rols/
    ├── app.py                       # Servidor Flask
    ├── SKILL.md                     # Lógica de negocio y reglas del skill
    ├── data/
    │   ├── Piezas terminadas.xlsx       # Stock real
    │   └── Piezas en fabricacion.xlsx   # Producción en curso
    ├── references/
    │   ├── colecciones.json             # Catálogo y restricciones
    │   ├── alternativas.json            # Mapa de alternativas Tier I/II
    │   └── *.md                         # Fichas en texto largo
    ├── scripts/
    │   ├── buscar_stock.py              # Motor de búsqueda
    │   └── parse_alternativas.py        # Convierte alternativas.md → .json
    └── templates/
        └── index.html                   # Frontend
```

## Actualizar los datos

- **Stock** y **fabricación**: reemplazar los `.xlsx` en `data/` y
  reiniciar la app.
- **Alternativas**: reexportar la página de Notion a
  `references/alternativas.md` y ejecutar:
  ```powershell
  python consulta-stock-rols/scripts/parse_alternativas.py
  ```

## Uso desde línea de comandos

El motor también puede usarse sin la web, devolviendo Markdown listo
para pegar al cliente:

```powershell
python consulta-stock-rols/scripts/buscar_stock.py `
  --consulta-completa --ref "Diana Herringbone Denim" --ancho 4 --largo 3 `
  --formato markdown
```
