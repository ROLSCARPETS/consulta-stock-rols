# Consulta de Stock Rols

App web local para consultar el stock de alfombras y moquetas de Rols
Carpets. Levanta un servidor Flask en `http://localhost:5050` con un panel
tipo Rols: sidebar de navegación, búsqueda guiada por formulario y chat en
lenguaje natural con tabla de resultados.

## Características

- **Búsqueda guiada** por referencia + ancho + largo, con validación de
  colección (avisa si la medida pedida no encaja en los rollos disponibles
  y sugiere la medida factible más cercana).
- **Chat en lenguaje natural** con interpretación por IA (OpenAI
  `gpt-4o-mini`):
  - Entiende faltas de ortografía: *"diaba herringbon denim 2 metros"* →
    Diana Herringbone Denim, ancho 2 m.
  - Entiende contexto entre mensajes: *"y de 5 metros?"* tras una consulta
    previa mantiene la referencia.
  - Detecta meta-preguntas: *"qué colores hay de Teide NX"* → muestra
    chips clicables con todos los colores activos.
  - Si OpenAI falla o no hay clave, hace **fallback automático** a un
    parser de regex local (la app sigue funcionando, sin coste).
- Píldora de **búsqueda activa** sticky con la referencia y medidas.
- Burbujas de chat tipo conversación (Tú ↔ IA).
- Consulta combinada de **stock terminado** y **piezas en fabricación**
  (con fecha estimada de fin de fabricación).
- Sugerencia automática de **alternativas** (Tier I / Tier II) cuando no
  hay stock ni fabricación, con comprobación de stock por alternativa.
- Anotaciones de pieza desplegables al click sobre el badge.

## Requisitos

- Windows con **Python 3.9+** instalado y en el `PATH`.
- Conexión a internet (la primera vez para instalar dependencias; después
  para llamar a OpenAI desde el chat).
- **Clave de OpenAI** (opcional pero recomendada — sin ella el chat
  funciona con regex, no con IA).

Dependencias Python: `flask`, `openpyxl`, `openai`, `python-dotenv`. Se
instalan solas la primera vez que se ejecuta el `.bat` (ver abajo).

## Configuración inicial — clave de OpenAI

1. Crea una clave en https://platform.openai.com/api-keys.
2. Copia el archivo `.env.example` a `.env` dentro de
   `Consulta de Stock Rols Agente/consulta-stock-rols/`:
   ```powershell
   cd "Consulta de Stock Rols Agente/consulta-stock-rols"
   copy .env.example .env
   ```
3. Edita `.env` y sustituye el placeholder por tu clave real:
   ```
   OPENAI_API_KEY=sk-proj-...
   ```
4. `.env` está en `.gitignore` — nunca se sube a GitHub.

> Si no quieres usar OpenAI, puedes saltarte este paso. La app arrancará
> igual y el chat usará el parser de regex automáticamente. Pierdes la
> tolerancia a errores de ortografía y la comprensión flexible, pero no
> el resto.

**Coste**: ~$0.0002 por consulta (gpt-4o-mini con prompt caching). Con
$5 de saldo te llega para ~25.000 consultas.

## Cómo arrancar la app

### Opción 1 — Doble clic (recomendada)

Doble clic en:

```
Consulta de Stock Rols Agente/Iniciar Consulta de Stock.bat
```

El `.bat` comprueba Python, instala las dependencias que falten (Flask,
openpyxl, openai, python-dotenv), arranca el servidor y abre el navegador
en `http://localhost:5050`.

### Opción 2 — Manual

```powershell
cd "Consulta de Stock Rols Agente/consulta-stock-rols"
pip install flask openpyxl openai python-dotenv
python app.py
```

Luego abre `http://localhost:5050` en el navegador.

## Estructura del proyecto

```
Consulta de Stock Rols Agente/
├── Iniciar Consulta de Stock.bat   # Lanzador para Windows
└── consulta-stock-rols/
    ├── app.py                       # Servidor Flask
    ├── SKILL.md                     # Lógica de negocio y reglas del skill
    ├── .env.example                 # Template para configurar OPENAI_API_KEY
    ├── .env                         # Tu clave real (gitignored)
    ├── data/
    │   ├── Piezas terminadas.xlsx       # Stock real
    │   └── Piezas en fabricacion.xlsx   # Producción en curso
    ├── references/
    │   ├── colecciones.json             # Catálogo y restricciones
    │   ├── alternativas.json            # Mapa de alternativas Tier I/II
    │   └── *.md                         # Fichas en texto largo
    ├── scripts/
    │   ├── buscar_stock.py              # Motor de búsqueda determinista
    │   ├── intent_parser.py             # Capa de IA (OpenAI gpt-4o-mini)
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
- **Catálogo de colecciones**: editar `references/colecciones.json` a mano
  cuando se añade/retira una colección activa. La app filtra el dropdown
  de referencias para mostrar solo las que pertenezcan a colecciones
  presentes en este archivo.

## Cómo funciona el chat (arquitectura)

Cada mensaje del chat sigue este flujo:

1. Frontend manda `{query, last_ref}` a `/api/consulta-nl`.
2. Backend intenta primero **OpenAI** (`scripts/intent_parser.py`):
   gpt-4o-mini extrae JSON con `{intent, ref, coleccion, ancho_m, largo_m}`.
   El catálogo va en el system prompt (≈2000 tokens, cacheado por OpenAI
   tras la primera llamada).
3. Si la IA devuelve algo válido (intent reconocido + ref existente en
   el catálogo) → se ejecuta la consulta.
4. Si la IA falla, hay timeout, alucina una ref que no existe, o no hay
   `OPENAI_API_KEY` → **fallback** al parser de regex en `app.py`
   (`parse_natural_query`).

Esto da lo mejor de los dos mundos: comprensión flexible cuando la IA
está disponible, robustez total cuando no.

## Uso desde línea de comandos

El motor también puede usarse sin la web, devolviendo Markdown listo
para pegar al cliente:

```powershell
python consulta-stock-rols/scripts/buscar_stock.py `
  --consulta-completa --ref "Diana Herringbone Denim" --ancho 4 --largo 3 `
  --formato markdown
```
