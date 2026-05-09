#!/usr/bin/env python3
"""Convierte alternativas.md (export de Notion) en alternativas.json.

Se ejecuta cuando se actualiza la pagina de Notion. Estructura de salida:

{
  "color_referencia (case-sensitive, normalizado a Title Case)": {
    "tier_1": [
      {"ref": "Maya Lite Coconut", "nota": "Mismo grosor de textura..."},
      ...
    ],
    "tier_2": [
      {"ref": "Terra Sahara Coconut", "nota": "Nudo mas grueso..."},
      ...
    ],
    "sin_alternativas": false
  },
  ...
}

Heurisica de parseo (no fully-fledged markdown, suficiente):
  - Una linea "- **Algo:**" abre un nuevo color.
  - Las lineas siguientes "- **Tier I (...) - Nota**" abren un tier.
  - Las lineas debajo "- **Maya X**" o "- Maya X" son refs alternativas.
  - "No tenemos referencias similares" -> sin_alternativas = True.
"""
from __future__ import annotations
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "references" / "alternativas.md"
DST = ROOT / "references" / "alternativas.json"


def clean(s: str) -> str:
    return s.replace("**", "").strip().rstrip(":").strip()


def main() -> int:
    text = SRC.read_text(encoding="utf-8")
    out: dict = {}

    # Estado parser
    color_actual: str | None = None
    tier_actual: str | None = None  # 'tier_1', 'tier_2'
    nota_tier_actual: str | None = None

    re_color = re.compile(r"^\s*-\s+\*\*([A-Za-z][^*]+?):\*\*\s*$")
    re_tier = re.compile(r"^\s*-\s+\*\*Tier\s+(I{1,2})\s*(?:\([^)]*\))?\s*-?\s*([^*]*)\*\*\s*$", re.IGNORECASE)
    re_alt = re.compile(r"^\s*-\s+\*?\*?([A-Za-z][^*\n]+?)\*?\*?\s*$")
    re_no_alts = re.compile(r"No tenemos referencias similares", re.IGNORECASE)

    for line in text.splitlines():
        # Detectar "color:"
        m = re_color.match(line)
        if m:
            color = clean(m.group(1))
            # Filtramos titulos de seccion como "COLECCION X"
            if color.upper() == color and " " in color and "COLECCION" in color.upper():
                color_actual = None
                continue
            color_actual = color
            tier_actual = None
            nota_tier_actual = None
            out[color_actual] = {"tier_1": [], "tier_2": [], "sin_alternativas": False}
            continue

        # Detectar tier
        m = re_tier.match(line)
        if m and color_actual:
            tier_num = m.group(1).upper()
            tier_actual = "tier_1" if tier_num == "I" else "tier_2"
            nota_tier_actual = clean(m.group(2)) or None
            continue

        # No alts
        if re_no_alts.search(line) and color_actual:
            out[color_actual]["sin_alternativas"] = True
            continue

        # Linea de alternativa
        m = re_alt.match(line)
        if m and color_actual and tier_actual:
            ref = clean(m.group(1))
            # filtrar lineas que son comentarios largos / parentesis
            if ref.startswith("(") or len(ref.split()) > 8:
                continue
            entry = {"ref": ref}
            if nota_tier_actual:
                entry["nota"] = nota_tier_actual
            # Evitar duplicados
            if entry["ref"] not in [e["ref"] for e in out[color_actual][tier_actual]]:
                out[color_actual][tier_actual].append(entry)

    # Limpia colores vacios (sin tier 1 ni tier 2 ni sin_alternativas explicito)
    out = {
        c: v for c, v in out.items()
        if v["tier_1"] or v["tier_2"] or v["sin_alternativas"]
    }

    DST.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: {len(out)} colores escritos en {DST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
