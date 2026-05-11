"""Parser de intent basado en LLM (OpenAI gpt-4o-mini).

Toma la query del usuario y devuelve un dict estructurado:
{intent, ref, coleccion, ancho_m, largo_m}.

Si OpenAI no está disponible o falla, devuelve None y el caller usa
el parser de regex de respaldo.

El catálogo va en el system prompt para aprovechar el prompt caching
automático de OpenAI (≥1024 tokens cacheados, 50% más barato tras
la primera llamada en una ventana de ~5-10 min).
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Optional

# Cargar .env si existe
try:
    from dotenv import load_dotenv
    _here = Path(__file__).resolve().parent
    for candidate in (_here / ".env", _here.parent / ".env"):
        if candidate.exists():
            load_dotenv(candidate)
            break
except ImportError:
    pass

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None


_client = None


def _get_client():
    """Cliente OpenAI singleton. Devuelve None si no hay SDK o clave."""
    global _client
    if _client is not None:
        return _client
    if OpenAI is None:
        return None
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None
    _client = OpenAI(api_key=api_key, timeout=15.0)
    return _client


LANG_NAMES = {
    "es": "espanol", "en": "english", "fr": "francais",
    "de": "aleman", "it": "italiano", "nl": "neerlandes",
    "pt": "portugues", "pl": "polaco",
}


def _build_system_prompt(catalogo: list[str], colecciones: list[str]) -> str:
    """System prompt determinista — clave para que OpenAI aproveche caching."""
    catalogo_txt = "\n".join(catalogo)
    colecciones_txt = "\n".join(colecciones)
    return f"""Eres un extractor de intent para una app de consulta de stock de
alfombras de Rols Carpets. Analizas la query del usuario y devuelves UN
OBJETO JSON con esta estructura EXACTA:

{{
  "intent": "consulta_stock" | "lista_colores" | "alternativas" | "no_entendido",
  "ref": <string del catalogo en MAYUSCULAS, o null>,
  "coleccion": <string del listado de colecciones, o null>,
  "ancho_m": <numero en metros, o null>,
  "largo_m": <numero en metros, o null>
}}

REGLAS DE INTENT:
- "consulta_stock": el usuario pregunta por disponibilidad de un producto.
  Ejemplos: "tienes palma icon sand 4x3", "30 ml de luna platinium",
  "necesito algo en diana herringbone".

- "lista_colores": pide ver MULTIPLES colores/referencias/tonos de una
  coleccion (la misma familia, hermanos del producto previo).
  Ejemplos:
    * "que colores hay de teide nx"
    * "muestrame las referencias de palma rock"
    * "que tonos tiene marina"
    * "dime otros colores de maya craft"
    * "dame mas colores de luna"
    * "que mas hay en diana"
    * "todos los colores de annabelle"
  IMPORTANTE: cuando el usuario dice "OTROS colores", "MAS colores",
  "OTRAS referencias" o similar, casi siempre quiere lista_colores
  (los hermanos del producto previo en la misma coleccion), NO
  alternativas (que serian otra coleccion distinta).

- "alternativas": pide referencias EQUIVALENTES de OTRA coleccion
  cuando la pedida no encaja o no hay stock. Solo cuando usa palabras
  explicitas: "alternativa", "alternativas", "similar", "parecido",
  "que se parezca", "otra opcion equivalente", "algo equivalente".
  Si dice "otros COLORES" o "mas COLORES" → es lista_colores, no alternativas.

- "no_entendido": si no puedes determinar la intencion con confianza.

REGLAS PARA "ref":
- Debe ser EXACTAMENTE una entrada del catalogo de abajo.
- Corrige faltas de ortografia leves cuando sea claro:
  "diaba herringbon denim" → "DIANA HERRINGBONE DENIM".
- Si solo se nombra la familia sin color (ej "palma rock"), deja ref=null
  y pon "coleccion" con el nombre exacto de la coleccion.
- Si la consulta no menciona producto explicito pero hay contexto previo
  (last_ref), USA EXACTAMENTE last_ref como ref (no la generalices a su
  coleccion). Ejemplo: query="y de 5 metros?" + last_ref="PALMA ICON SAND"
  → ref="PALMA ICON SAND" (NO ref=null, coleccion="PALMA ICON").

REGLAS PARA MEDIDAS:
- Convierte cm a m: 300cm → 3.
- "X ml" o "X metros lineales" → largo_m=X.
- "X de largo" → largo_m. "X de ancho" → ancho_m.
- "X x Y" o "X por Y" → ancho_m=X, largo_m=Y (primer numero es ancho).
- Si dice solo un numero pequeño sin contexto, dejalo en largo_m.

CATALOGO ACTIVO ({len(catalogo)} referencias):
{catalogo_txt}

COLECCIONES ({len(colecciones)}):
{colecciones_txt}

Devuelve SOLO el objeto JSON, sin texto adicional. Asegurate de que el
JSON sea valido y los nombres exactos."""


def parse_with_ai(query: str, last_ref: Optional[str],
                  catalogo: list[str], colecciones: list[str],
                  *, model: str = "gpt-4o-mini",
                  lang: str = "es") -> Optional[dict]:
    """Devuelve dict {intent, ref, coleccion, ancho_m, largo_m} o None.

    None puede significar: SDK no instalado, sin API key, error de red,
    JSON inválido. En cualquier caso el caller debe usar el regex de
    respaldo.
    """
    client = _get_client()
    if client is None:
        return None

    system = _build_system_prompt(catalogo, colecciones)
    user_msg = f"Consulta del usuario: {query}"
    if last_ref:
        user_msg += f"\nUltima referencia consultada (contexto): {last_ref}"
    # Pista de idioma para el extractor — solo afecta a campos textuales
    # libres si los hubiera; los campos de intent/ref/coleccion son codigos
    # que NO se traducen.
    lang_name = LANG_NAMES.get(lang, "espanol")
    user_msg += f"\nIdioma del usuario: {lang_name} (codigo {lang})."

    t0 = time.monotonic()
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_msg},
            ],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=200,
        )
    except Exception as e:
        print(f"[intent_parser] OpenAI error: {type(e).__name__}: {e}")
        return None
    elapsed_ms = (time.monotonic() - t0) * 1000

    content = resp.choices[0].message.content if resp.choices else None
    if not content:
        return None

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as e:
        print(f"[intent_parser] JSON invalido: {e} | content={content!r}")
        return None

    print(f"[intent_parser] {elapsed_ms:.0f}ms | {parsed.get('intent')!r} | "
          f"ref={parsed.get('ref')!r} col={parsed.get('coleccion')!r} "
          f"ancho={parsed.get('ancho_m')} largo={parsed.get('largo_m')}")
    return parsed
