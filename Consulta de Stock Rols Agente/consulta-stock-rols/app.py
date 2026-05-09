"""App web local para consultar stock de Rols.

Levanta un servidor Flask en localhost:5000 con un panel tipo Rols:
sidebar de navegacion + busqueda guiada (formulario) + chat en lenguaje
natural + panel de respuesta a la derecha (mensaje IA + tabla).

Usa scripts/buscar_stock.py como motor.
"""

from __future__ import annotations

import re
import sys
import time
from datetime import datetime
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(APP_DIR / "scripts"))

from flask import Flask, render_template, request, jsonify  # noqa: E402

import buscar_stock as bs  # noqa: E402


app = Flask(__name__)

# ---------------------------------------------------------------------------
# Carga inicial de datos (una sola vez al arrancar)
# ---------------------------------------------------------------------------

print("Cargando stock terminado…")
PIEZAS = bs.cargar_piezas(bs.DEFAULT_EXCEL)
print(f"  -> {len(PIEZAS)} piezas")

print("Cargando piezas en fabricación…")
try:
    PIEZAS_FAB = bs.cargar_piezas_fabricacion(bs.DEFAULT_EXCEL_FABRICACION)
    print(f"  -> {len(PIEZAS_FAB)} piezas")
except FileNotFoundError:
    PIEZAS_FAB = []

print("Cargando colecciones y alternativas…")
COLECCIONES = bs.cargar_colecciones()
ALTERNATIVAS = bs.cargar_alternativas()
print(f"  -> {len(COLECCIONES)} colecciones, {len(ALTERNATIVAS)} colores con alternativas")

DESCRIPCIONES = sorted({p.descripcion for p in PIEZAS} | {p.descripcion for p in PIEZAS_FAB})
print(f"  -> {len(DESCRIPCIONES)} referencias unicas")

LOAD_TIME = time.time()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def parse_natural_query(query: str) -> dict:
    """Extrae ref + medidas (en metros) de un texto en lenguaje natural.

    Devuelve adicionalmente:
      - "coleccion_ambigua": str|None — si la query no apunta a un color
        concreto sino a varios (ej. "palma rock" matchea 6 colores).
      - "colores_disponibles": list[str] — los colores candidatos cuando hay
        ambiguedad. Vacio si no.
    """
    nq = bs.normalizar(query)

    # 1) Detectar la descripcion (color completo) mas larga que aparezca
    ref = None
    best_len = 0
    for desc in DESCRIPCIONES:
        nd = bs.normalizar(desc)
        if nd and nd in nq and len(nd) > best_len:
            ref = desc
            best_len = len(nd)
    if ref:
        nq_resto = nq.replace(bs.normalizar(ref), " ", 1)
    else:
        nq_resto = nq

    # 2) Detectar ambiguedad: si no hay descripcion exacta pero el texto
    # contiene tokens que aparecen juntos en varias descripciones.
    PALABRAS_RELLENO = {
        "DE", "EN", "ES", "EL", "LA", "LO", "LOS", "LAS", "MAS", "MENOS",
        "METROS", "METRO", "ML", "CM", "MM", "M", "QUIERO", "NECESITO",
        "DAME", "MIRAME", "HAY", "TIENES", "TENGO", "BUSCO", "ALGO", "UNA",
        "UN", "POR", "FAVOR", "ME", "MI", "TU", "ANCHO", "LARGO", "ANCHURA",
        "LONGITUD", "ALTURA", "ALTO", "MEDIDAS", "MEDIDA", "PARA", "AL",
        "X", "PARA", "STOCK",
    }
    coleccion_ambigua = None
    colores_disponibles: list[str] = []
    if not ref:
        # Quitar numeros y palabras de relleno
        texto_kw = re.sub(r"\d+(?:[.,]\d+)?", " ", nq)
        tokens_query = [t for t in re.split(r"[^A-Z0-9]+", texto_kw) if t and t not in PALABRAS_RELLENO]
        if tokens_query:
            matches = []
            for desc in DESCRIPCIONES:
                nd_tokens = set(re.split(r"[^A-Z0-9]+", bs.normalizar(desc)))
                if all(t in nd_tokens for t in tokens_query):
                    matches.append(desc)
            if len(matches) == 1:
                ref = matches[0]
                nq_resto = nq.replace(bs.normalizar(ref), " ", 1)
            elif len(matches) >= 2:
                coleccion_ambigua = " ".join(tokens_query).title()
                colores_disponibles = matches

    if not ref and not coleccion_ambigua:
        ref = query  # ultimo recurso: el script intenta su matcher difuso

    flags = re.IGNORECASE
    es_cm = bool(re.search(r"\bcm\b", nq_resto, flags))
    def _conv(n):
        return n / 100 if es_cm else n

    # Patron AxB
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)", nq_resto, flags)
    if m:
        return {
            "ref": ref, "ancho": _conv(float(m.group(1).replace(",", "."))),
            "largo": _conv(float(m.group(2).replace(",", "."))),
            "coleccion_ambigua": coleccion_ambigua,
            "colores_disponibles": colores_disponibles,
        }

    re_ancho = r"(\d+(?:[.,]\d+)?)\s*(?:cm|m|metros?)?\s*(?:de\s+)?(?:ancho|anchura)"
    re_largo = r"(\d+(?:[.,]\d+)?)\s*(?:cm|m|metros?)?\s*(?:de\s+)?(?:largo|longitud|alto|altura)"
    m_a = re.search(re_ancho, nq_resto, flags)
    m_l = re.search(re_largo, nq_resto, flags)
    ancho = _conv(float(m_a.group(1).replace(",", "."))) if m_a else None
    largo = _conv(float(m_l.group(1).replace(",", "."))) if m_l else None
    if ancho is not None or largo is not None:
        return {"ref": ref, "ancho": ancho, "largo": largo,
                "coleccion_ambigua": coleccion_ambigua,
                "colores_disponibles": colores_disponibles}

    nums = [float(n.replace(",", ".")) for n in re.findall(r"\d+(?:[.,]\d+)?", nq_resto)]
    nums = [_conv(n) for n in nums]
    if not nums:
        return {"ref": ref, "ancho": None, "largo": None,
                "coleccion_ambigua": coleccion_ambigua,
                "colores_disponibles": colores_disponibles}

    pista_largo = bool(re.search(
        r"\b(?:ml|metros?\s+lineales?|longitud|mas\s+de|al\s+menos|necesito|quiero|hay|tengo)\b",
        nq_resto, flags
    ))
    if len(nums) == 1:
        n = nums[0]
        if pista_largo or n > 4:
            return {"ref": ref, "ancho": None, "largo": n,
                    "coleccion_ambigua": coleccion_ambigua,
                    "colores_disponibles": colores_disponibles}
        return {"ref": ref, "ancho": n, "largo": None,
                "coleccion_ambigua": coleccion_ambigua,
                "colores_disponibles": colores_disponibles}

    return {"ref": ref, "ancho": nums[0], "largo": nums[1],
            "coleccion_ambigua": coleccion_ambigua,
            "colores_disponibles": colores_disponibles}



def _formatear_resultado_para_tabla(resultado: dict) -> list[dict]:
    """Aplana stock + fabricacion en filas listas para la tabla del frontend."""
    filas = []
    for p in resultado.get("stock", []):
        filas.append({
            "descripcion": p["descripcion"],
            "lote": p["lote"],
            "ancho": p["ancho"],
            "longitud_no_comprometida": p["longitud_no_comprometida"],
            "estado": p["estado"],
            "tipo": "stock",
            "obs_revision": p.get("obs_revision"),
            "obs_venta": p.get("obs_venta"),
            "reservada_temporal": p.get("reservada_temporal", 0),
        })
    fab = resultado.get("fabricacion") or {}
    for p in fab.get("piezas", []):
        filas.append({
            "descripcion": p["descripcion"],
            "lote": p["lote"],
            "ancho": p["ancho"],
            "longitud_no_comprometida": p["longitud_no_comprometida"],
            "estado": p["estado"],  # 'Lanzada' / 'Planif. en firme'
            "tipo": "fabricacion",
            "fecha_disponibilidad": p.get("fecha_disponibilidad"),
            "fecha_retraso": p.get("fecha_retraso"),
        })
    return filas


def _ejecutar_consulta(ref, ancho, largo):
    """Llama al motor y monta el dict de respuesta para el frontend."""
    if not ref:
        return None
    resultado = bs.consulta_completa(
        ref, ancho, largo, PIEZAS, PIEZAS_FAB, COLECCIONES, ALTERNATIVAS, limite=20
    )
    markdown = bs.render_markdown(resultado)

    if resultado["stock"]:
        tipo = "stock"
    elif resultado.get("fabricacion") and resultado["fabricacion"].get("piezas"):
        tipo = "fabricacion"
    elif resultado.get("fabricacion") and resultado["fabricacion"].get("todas_comprometidas"):
        tipo = "todas_comprometidas"
    else:
        tipo = "sin_stock"

    # Mensaje breve y conversacional para la "burbuja" del asistente
    n_stock = len(resultado["stock"])
    n_fab = len((resultado.get("fabricacion") or {}).get("piezas", []))
    if tipo == "stock":
        mejor = resultado["stock"][0]
        mensaje = (
            f"Tenemos **{n_stock} {'pieza' if n_stock == 1 else 'piezas'}** que cumplen tu consulta. "
            f"La más recomendada es **{mejor['descripcion']}** "
            f"(lote {mejor['lote']}, {mejor['longitud_no_comprometida']:.2f} m libres)."
        )
    elif tipo == "fabricacion":
        mejor = resultado["fabricacion"]["piezas"][0]
        mensaje = (
            f"No hay stock terminado, pero hay **{n_fab} {'pieza' if n_fab == 1 else 'piezas'} en fabricación**. "
            f"La más cercana es {mejor['lote']} ({mejor['longitud_no_comprometida']:.2f} m libres, "
            f"disponible ~{mejor['fecha_disponibilidad']}). "
            f"¿Quieres que mire también **alternativas que sí tengamos en stock**?"
        )
    elif tipo == "todas_comprometidas":
        mensaje = (
            "No hay stock terminado y **toda la fabricación en curso de esa referencia "
            "ya está reservada**. ¿Quieres que mire alternativas similares?"
        )
    else:
        mensaje = (
            f"No hay stock terminado de **{ref}** ni fabricación dada de alta. "
            f"¿Quieres que mire referencias similares?"
        )

    return {
        "tipo": tipo,
        "mensaje": mensaje,
        "markdown": markdown,
        "filas": _formatear_resultado_para_tabla(resultado),
        "n_stock": n_stock,
        "n_fabricacion": n_fab,
        "alternativas": resultado.get("alternativas"),
        "consulta": {"ref": ref, "ancho": ancho, "largo": largo},
    }


# ---------------------------------------------------------------------------
# Rutas
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html",
                           sync_time=datetime.fromtimestamp(LOAD_TIME).strftime("%H:%M"))


@app.route("/api/refs")
def api_refs():
    return jsonify(DESCRIPCIONES)


@app.route("/api/consulta", methods=["POST"])
def api_consulta():
    data = request.get_json(force=True)
    ref = (data.get("ref") or "").strip()
    ancho = data.get("ancho")
    largo = data.get("largo")
    unidad = (data.get("unidad") or "m").lower()  # 'm' o 'cm'

    if not ref:
        return jsonify({"error": "Falta la referencia"}), 400

    try:
        ancho = float(ancho) if ancho not in (None, "") else None
        largo = float(largo) if largo not in (None, "") else None
    except (TypeError, ValueError):
        return jsonify({"error": "Ancho y largo deben ser numeros"}), 400

    if unidad == "cm":
        if ancho is not None:
            ancho = ancho / 100
        if largo is not None:
            largo = largo / 100

    return jsonify(_ejecutar_consulta(ref, ancho, largo))


@app.route("/api/consulta-nl", methods=["POST"])
def api_consulta_nl():
    data = request.get_json(force=True)
    query = (data.get("query") or "").strip()
    if not query:
        return jsonify({"error": "Falta la consulta"}), 400

    parsed = parse_natural_query(query)

    # Caso ambiguo: el cliente nombro una coleccion sin especificar color
    if parsed.get("coleccion_ambigua"):
        col = parsed["coleccion_ambigua"]
        colores = parsed["colores_disponibles"]
        # Quitar el prefijo de coleccion del nombre del color para chips mas limpios
        col_norm = bs.normalizar(col)
        chips = []
        for c in colores:
            cn = bs.normalizar(c)
            if cn.startswith(col_norm):
                chips.append({
                    "ref": c,
                    "label": c[len(col):].strip() or c,
                })
            else:
                chips.append({"ref": c, "label": c})
        mensaje = (
            f"Has preguntado por **{col}** pero no me has dicho qué color. "
            f"Tenemos {len(colores)} colores disponibles — dime cuál (o pulsa abajo)."
        )
        return jsonify({
            "tipo": "necesita_color",
            "mensaje": mensaje,
            "filas": [],
            "alternativas": None,
            "chips_color": chips,
            "consulta_original": {
                "ancho": parsed.get("ancho"),
                "largo": parsed.get("largo"),
            },
            "parsed": parsed,
        })

    out = _ejecutar_consulta(parsed["ref"], parsed["ancho"], parsed["largo"])
    if out is None:
        return jsonify({"error": "No pude entender la consulta"}), 400
    out["parsed"] = parsed
    return jsonify(out)


if __name__ == "__main__":
    print()
    print("=" * 60)
    print("  Consulta de Stock Rols — http://localhost:5000")
    print("=" * 60)
    print()
    app.run(host="127.0.0.1", port=5000, debug=False)
