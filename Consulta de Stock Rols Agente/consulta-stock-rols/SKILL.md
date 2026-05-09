---
name: consulta-stock-rols
description: Consulta el stock de alfombras y moquetas de Rols Carpets. Úsalo siempre que el usuario pregunte por disponibilidad, stock, piezas, lotes o rollos de cualquier referencia/colección de Rols (Diana, Lara, Annabelle, Luna, Maya, Terra, Marina, Victoria, Vega, etc.). También úsalo cuando pregunten "¿tenéis X?", "¿cuánto queda de Y?", "necesito Z metros de…", "¿hay rollos de…?", o pidan medidas concretas (ancho × largo). Si el usuario menciona una medida sin nombrar producto, pregúntale el producto y luego llama al skill. No lo uses para pedidos, presupuestos o información comercial general no relacionada con stock.
---

# Consulta de stock de Rols Carpets

Este skill permite a comerciales internos y a clientes B2B (tiendas, interioristas) preguntar por la disponibilidad de cualquier referencia de Rols. Comprueba el stock terminado, valida que la medida pedida sea posible en esa colección, y prepara una respuesta clara con los lotes disponibles. Cuando esté listo el fichero de fabricación, también lo consultará para informar de fechas previstas.

## Datos disponibles ahora mismo

Todo está local dentro del skill. **El agente NO consulta Notion en runtime** — las páginas relevantes se han mirroreado a `references/` y se actualizan reexportando desde Notion cuando cambian.

- **Stock terminado** — `data/Piezas terminadas.xlsx`. Cada fila es una pieza física (un rollo) identificada por un Nº de lote, con su ancho, longitudes (actual / disponible / reservada / no comprometida), estado y observaciones.
- **Piezas en fabricación** — `data/Piezas en fabricacion.xlsx`. Cada fila es una pieza en fabricación. Columnas: Estado (Lanzada / Planif. en firme), Descripción, Nº Lote, Ancho, Longitud, Reservada firme, Reserva temporal, Longitud no comprometida, Fecha Planif. Fin Fabricacion, Estado Pieza, Fecha Entrega Requerida, Fecha retraso fabricación.
- **Catálogo de colecciones** — `references/colecciones.json`. Para cada colección: anchos de rollo, tamaño máximo como alfombra confeccionada, si solo se vende como alfombra (no como corte de moqueta), si la orientación del diseño afecta a girar las medidas, material y si es apta para exterior.
- **Mapa de alternativas** — `references/alternativas.json` (estructurado, búsqueda < 100 ms). Para cada color: lista Tier I (misma colección/familia, otro diseño) y Tier II (otra colección, color/uso similar), con nota explicativa por tier. Algunos colores tienen `sin_alternativas: true`.
- **Fichas de colecciones permanentes** — `references/colecciones_permanentes.md`. Texto largo en lenguaje natural (descripción, puntos clave, recomendaciones por uso, mantenimiento). Lo lee el agente cuando se le pregunta por características de una colección.

> Para refrescar `alternativas.json` cuando cambia la página de Notion: reexportar el .md a `references/alternativas.md` y ejecutar `python consulta-stock-rols/scripts/parse_alternativas.py`.

## Atajo recomendado: `--consulta-completa --formato markdown`

Cuando ya se tienen los tres datos (ref + ancho + largo confirmados), **una sola llamada resuelve todo el flujo y devuelve la respuesta lista para enviar al cliente**:

```bash
python consulta-stock-rols/scripts/buscar_stock.py \
  --consulta-completa --ref "Diana Herringbone Denim" --ancho 4 --largo 3 \
  --formato markdown
```

Esto ejecuta internamente: validación de colección → búsqueda en stock → si no hay stock, búsqueda en fabricación → si tampoco, lookup de alternativas. La salida es Markdown con la tabla y la frase de respuesta ya redactadas según las reglas de este skill.

**El agente solo necesita pegar la salida tal cual.** Si en la salida aparece un comentario HTML `<!-- Alternativas disponibles si el cliente acepta: ... -->`, son las opciones de Tier I / Tier II que el agente puede usar si el cliente responde *"sí, mírame opciones"*.

Cuándo NO usar el atajo (y volver al flujo paso a paso de abajo):
- Cuando falte algún dato (color, ancho, o largo) — primero hay que conseguirlo (Paso 1).
- Cuando la medida pedida no encaja directamente en el ancho del rollo de la colección y hay que decidir si rotar — primero hay que validar/confirmar la rotación (Paso 2).
- Cuando se quiere depurar o inspeccionar datos — `--formato json` da el mismo flujo pero estructurado.

## Cómo razonar sobre una consulta

El flujo conceptual siempre es el mismo, lo ejecute el atajo o lo haga el agente paso a paso:

### Paso 1 — Identificar producto y medidas

Antes de buscar nada, el agente necesita dos datos:

1. **Referencia** del producto. Atención: en Rols, dentro de la misma colección (p. ej. *Diana Herringbone*) hay variantes por color que son **referencias distintas** — *Diana Herringbone Denim* y *Diana Herringbone Stone* no son intercambiables. Si el usuario nombra solo la colección sin el color, pregúntale por el color/variante.
2. **Medidas necesarias**: ancho × largo de la alfombra o del corte de moqueta. Si la consulta llega solo con el producto y sin medida, pregúntala. Si llega solo medida sin producto, pregunta el producto.

   > **Confirmar siempre la orientación de la medida.** Cuando el usuario diga *"2x3"* o *"3x4"* sin etiquetar cuál número es ancho y cuál largo, **no asumas y busques**: confirma con una frase tipo *"¿Te refieres a 2 m de ancho × 3 m de largo?"*. La convención por defecto es que el primer número es el ancho, pero la confirmación es obligatoria porque ancho y largo no son intercambiables (el ancho está limitado por el rollo). Equivocarse en silencio puede llevar a decir que una medida no cabe cuando sí cabría girada (o al revés). Solo después de la confirmación se pasa al Paso 2.

### Paso 2 — Validar la medida contra la colección

Antes de mirar el stock, valida que la medida es físicamente posible en esa colección. Para esto usa `colecciones.json`:

- **Cada colección tiene anchos de rollo concretos** (típicamente `[2, 4]` para colecciones de lana o `[2, 3]` para PET reciclado). El ancho de la alfombra pedida no puede superar el ancho máximo de rollo de la colección.
- **El largo no es problema**: si una pieza física no llega, se pueden encadenar rollos; el largo siempre puede ser mayor.
- **Si el ancho pedido > ancho máximo de la colección**:
  - Comprueba si **rotando las medidas** cabe (p. ej. el cliente pide 4×3 en una colección con ancho máx. 3 m → ofrece servirlo como 3×4).
  - Si la rotación es viable y la colección tiene `orientacion_importa = true`, **avisa al cliente** que al girar las medidas el diseño cambia de orientación y pídele confirmación.
  - Si ni así cabe, dilo claramente: "no es posible en esta colección".
- **Si la colección tiene `solo_alfombra = true`** (ej. Marina, Aral, Strata, todas las Terra): no se sirve como corte de rollo, solo como alfombra confeccionada. Avísalo.
- **Si el ancho pedido encaja en un ancho de rollo más pequeño**: úsalo. Ejemplo: pide 2,5 m de ancho en Diana Herringbone (anchos disponibles 2 y 4) → hay que usar el de 4 m.

Para automatizar esta validación, puedes invocar:

```bash
python consulta-stock-rols/scripts/buscar_stock.py --validar-coleccion "Diana Herringbone"
```

### Paso 3 — Buscar en stock terminado

Ya con producto y medidas validados, busca piezas que cumplan **todos** estos criterios:

- **Coincidencia de referencia** con la descripción del Excel (matching difuso por tokens; el script ya lo hace).
- **Ancho de la pieza ≥ ancho del rollo necesario** (típicamente el ancho calculado en el paso 2).
- **Longitud no comprometida ≥ largo necesario**. La columna a usar es **"Longitud no comprometida"** (no "Longitud disponible"), porque excluye también las reservas temporales y refleja la disponibilidad real.

> **Regla crítica: las piezas no se suman.** Cada rollo tiene que cubrir individualmente el largo pedido. Si una sola pieza no llega, no es válido proponer combinar dos rollos cortos para sumar el metraje (al unirlos se notarían diferencias de color, dirección de pelo, etc.). Si ninguna pieza individual lo cubre, hay que pasar al paso 4 (fabricación) o al paso 5 (alternativas) — nunca sugerir suma de rollos.

> **Filtro de retales:** las piezas con **longitud no comprometida inferior a 50 cm** se consideran retales/scrap y **no se muestran nunca** en una consulta de stock — no son metraje vendible. El script ya las descarta por defecto. Si en algún contexto interno se necesita ver el inventario completo, usar `--incluir-retales`.

Comando recomendado:

```bash
python consulta-stock-rols/scripts/buscar_stock.py \
  --ref "Diana Herringbone Denim" \
  --ancho 4 --largo 3
```

La salida es JSON con la lista de piezas que cumplen, ordenadas por mejor match y mayor longitud. Cada pieza incluye descripción, lote, ancho, longitudes, estado y observaciones.

### Paso 4 — Si en terminados no hay suficiente, mira fabricación

**Cuándo entrar aquí:** SOLO si el Paso 3 no devolvió ninguna pieza válida. Si en stock terminado hay aunque sea una pieza que cumple, NO se menciona fabricación al cliente.

**Cómo se busca:** mismo criterio de referencia, ancho ≥ pedido, longitud no comprometida ≥ pedida. El script devuelve lo que toca cuando se pasa `--fabricacion`:

```bash
python consulta-stock-rols/scripts/buscar_stock.py \
  --ref "Lara Uni Alpine" --ancho 4 --largo 25 --fabricacion
```

Con `--fabricacion`, si hay stock terminado, no toca el Excel de fabricación. Si no hay stock, busca en fabricación y devuelve un bloque `fabricacion: { piezas, candidatas_con_match, todas_comprometidas }`.

**Filtros específicos de fabricación:**

- **Excluir piezas con `Longitud no comprometida = 0`**: si toda la pieza está reservada (firme + temporal), no se ofrece.
- **NO aplicar el filtro de retales <0,5 m** que sí aplica en stock: en fabricación cualquier metraje libre > 0 es ofrecible (se entrega la pieza entera).
- Las piezas no se suman entre sí (misma regla que en stock).

**Fecha que comunicar al cliente:**

- Si la pieza tiene **"Fecha retraso fabricación"** rellena → usar esa fecha.
- Si no hay retraso → usar **"Fecha Planif. Fin Fabricacion"**.
- Comunicarla siempre como fecha estimada ("Disp. ~2026-07-17"), no como compromiso firme.
- La columna *Fecha Entrega Requerida* es un compromiso interno con otro cliente — no usarla para responder, pero si se quiere ser cauto se puede pasar a Paso 5 cuando esa fecha sea anterior a la planif. fin (la pieza puede estar ya prometida).

**Casos de respuesta al cliente:**

1. **Fabricación cubre la consulta** → responder con la(s) pieza(s) en fabricación, indicando estado (Lanzada / Planif. en firme) y fecha estimada.
2. **Hay piezas en fabricación de esa ref pero todas con `Longitud no comprometida = 0`** (`fabricacion.todas_comprometidas: true`) → decirlo expresamente:
   > "En este momento no tenemos stock terminado y **toda la fabricación en curso de esa referencia ya está reservada**. ¿Quieres que mire referencias similares?"
3. **No hay nada planificado** (`fabricacion.candidatas_con_match: 0`) → responder:
   > "En terminados no tenemos suficiente stock y todavía no hay fabricación dada de alta para esa referencia. Si te pones en contacto con nosotros, te confirmamos para cuándo entraría la próxima fabricación. ¿Quieres que mire referencias similares ya fabricadas?"

### Paso 5 — Si tras Paso 3 (terminados) y Paso 4 (fabricación) sigue sin haber forma de servir la medida

**Importante: las alternativas NO se proponen automáticamente.** Primero hay que **preguntar al cliente** si quiere ver opciones similares; si dice que sí, pasar a buscarlas. Si dice que no, terminar la conversación con el plan de fabricación o un "ponte en contacto con nosotros".

**Orden estricto de la respuesta:**

1. Decir claramente que **no hay stock terminado** que cubra la medida.
2. Decir el **estado de fabricación**: si hay piezas previstas con fecha (Paso 4), informarla; si no hay nada planificado, decirlo.
3. **Preguntar:** *"¿Quieres que te mire opciones similares en otras referencias / colores que sí tengamos en stock?"*
4. **Solo si el cliente confirma**, pasar a buscar alternativas.

**Cómo buscar alternativas (cuando el cliente las acepta):**

- **Fuente canónica local**: `references/alternativas.json` (mirror estructurado de la página de Notion *"Referencias alternativas en caso de no tener stock"*). Para consultarlo:

  ```bash
  python consulta-stock-rols/scripts/buscar_stock.py --alternativas-de "Palma Rock Sand"
  ```

  Devuelve `{ found, color, tier_1: [{ref, nota}], tier_2: [...], sin_alternativas }`:
  - **Tier I** — misma familia o construcción equivalente, otro diseño/color similar.
  - **Tier II** — otra colección con uso/colorido similar pero distinta construcción.
- Recorrer las propuestas devueltas: para cada `ref`, volver al Paso 3 y buscar piezas que cubran la medida (≥ ancho, ≥ largo, sin sumar, sin retales).
- Si una alternativa de Tier II es una colección **solo-alfombra** y la medida pedida supera el formato estándar (4×6 o 3×6), flagar como **"viable solo tras validación técnica con fabricación"** — no comprometerlo automáticamente.
- Si el JSON devuelve `sin_alternativas: true` (caso de Kilt 01, Kilt 02, Kilt 04 entre otros), decirlo al cliente: *"Para esa referencia no tenemos alternativas equivalentes en catálogo"*.
- Si la consulta devuelve `found: false`, proponer 2–3 colores cromáticamente equivalentes dentro de la misma colección que sí tengan stock (misma temperatura cálido/frío, misma profundidad claro/medio/oscuro), o pasar a "ponte en contacto".

**Si el cliente insiste en la referencia original exacta**, no seguir empujando alternativas: dar el plan de fabricación y, si no lo hay, ofrecer contactar con el equipo comercial.

> El JSON se regenera con `python consulta-stock-rols/scripts/parse_alternativas.py` a partir de `references/alternativas.md` (export de Notion). Si la página de Notion cambia, reexportar el .md y volver a ejecutar el parser. **No consultar Notion en runtime.**

## Reglas de presentación de resultados

### Qué columnas mostrar al usuario

**Formato obligatorio.** Siempre que haya piezas que cumplan los criterios, además del texto de la respuesta hay que mostrar **debajo** una tabla con **estas 5 columnas, en este orden**:

| Lote | Ancho | Longitud no comprometida | Estado | Notas |
|---|---|---|---|---|

Esto aplica también si hay solo 1 pieza, y también en respuestas donde se ofrecen alternativas (cada alternativa con su propia tabla). Si **no hay piezas** que cumplan, no hay tabla — se reporta en texto y se pasa al Paso 4 / 5.

**Reglas dentro de la tabla:**
- **Lote**: Nº de lote tal cual aparece en el Excel.
- **Ancho**: en metros, sin decimales innecesarios (4 m, no 4,00 m).
- **Longitud no comprometida**: nombre literal, en metros con dos decimales (ej. *5,25 m*). Nunca llamarlo "disponible" — esa es otra columna del Excel y, si una pieza tiene reservas temporales, "disponible" da un número más alto que el real.
- **Estado**:
  - Si la pieza viene del Excel de stock terminado → valor del campo *Estado Pieza* (Correcto / Saldo / Aprestado / Ver Anotaciones). No mostrar Agotado.
  - Si la pieza viene del Excel de fabricación → "Lanzada" o "Planif. en firme" (literal del Excel). Esto distingue las piezas que se están fabricando dentro de la misma tabla.
- **Notas**:
  - Para piezas en stock: información sensible para que el comercial decida — reservas temporales pendientes, observaciones de revisión que afecten al corte, *obs venta*, etc.
  - Para piezas en fabricación: usar este espacio para la **fecha estimada de disponibilidad** ("Disp. ~2026-07-17" o "Retraso a 2026-05-29" si la fecha viene del campo de retraso).
  - Si no hay nada que añadir, dejar un guion (—).

**Ejemplo de tabla (solo stock):**

| Lote | Ancho | Longitud no comprometida | Estado | Notas |
|---|---|---|---|---|
| **RP26-0103-001** | 4 m | **30,50 m** | Correcto | — |
| RP25-0032-001 | 4 m | 5,25 m | Correcto | *"A 4,5 ML. parada/abono 0,5×4"* — defecto dentro del corte de 5 m, descartar |
| RP25-0547-015 | 4 m | 9,35 m | Correcto | ⚠️ De 26 m totales tiene 16,65 m reservados temporalmente; validar antes de comprometer |

**Ejemplo de tabla (sin stock, mostrando fabricación):**

| Lote | Ancho | Longitud no comprometida | Estado | Notas |
|---|---|---|---|---|
| RP26-0149-003 | 4 m | 40,00 m | Lanzada | Disp. ~2026-07-17 |
| RP26-0149-002 | 4 m | 30,00 m | Lanzada | Disp. ~2026-07-17 |
| RP26-0224-001 | 4 m | 17,50 m | Planif. en firme | Disp. ~2026-11-13 |

### Estados de pieza

El Excel tiene estos estados: **Correcto**, **Saldo**, **Aprestado**, **Ver Anotaciones**, **Agotado**.

- **Correcto**: pieza en estado óptimo, prioridad para servir.
- **Saldo**: pieza vendible con descuento — etiquétala claramente como "saldo".
- **Aprestado / Ver Anotaciones**: vendibles pero requieren mirar las observaciones; etiquétalas con un aviso para que el comercial valide manualmente.
- **Agotado**: no la propongas como disponible.

> **Política actual**: mostrar todas las piezas con etiqueta clara del estado. En el futuro, cuando el agente atienda directamente a clientes finales, el filtro será solo "Correcto" — pero esto se controlará desde fuera del skill.

### Observaciones de revisión

La columna *"Observaciones revisión"* (p. ej. *"ALGUNA MARCA DE VARILLA"*, *"TRATADO/ATIGRADITO"*) contiene información de calidad sensible.

- **Para comerciales internos**: muéstralas siempre, son información clave para decidir si la pieza sirve para un cliente concreto.
- **Para clientes B2B (tiendas / interioristas)**: por defecto **no las muestres**. Si la pieza tiene observaciones, indica algo genérico tipo "esta pieza tiene observaciones internas; consultar antes de comprometer".

(Cuando se incorpore distinción de roles, este comportamiento se hará automático. De momento, si no sabes con quién hablas, asume comercial interno y enseña todo.)

### Reservas temporales

Si una pieza tiene reservas temporales (`reservada_temporal > 0`), añade una nota: *"hay reserva temporal pendiente; validar antes de comprometer"*. La `longitud_no_comprometida` ya descuenta la reserva, pero el comercial debe saber que el panorama puede cambiar.

### Lo que NO hay que mencionar en la respuesta al cliente

**No comentar la gestión interna del rollo de origen.** Si el cliente pide una pieza de 2 m de ancho y la única disponible es de 4 m, basta con mostrar la pieza y su ancho real; **no añadir** notas tipo *"se cortará el rollo a la mitad y quedará un retal de 2 m sobrantes"*. El cliente paga el metraje del ancho que ha pedido; cómo se aprovecha el rollo origen es asunto interno de fábrica y no aporta valor al cliente — al contrario, introduce ruido.

## Ejemplos de conversación

**Ejemplo 1 — Consulta directa con todos los datos**

> Usuario: "¿Tenéis Diana Herringbone Denim de 4 × 3?"

Razonamiento: producto = `Diana Herringbone Denim`; medidas = ancho 4 m, largo 3 m. Diana Herringbone tiene anchos `[2, 4]` y máximo de alfombra `[4, 6]` → la medida cabe directamente en el rollo de 4 m. Buscar en stock con `--ref "Diana Herringbone Denim" --ancho 4 --largo 3`.

**Ejemplo 2 — Medida que no cabe en el ancho directo**

> Usuario: "Necesito 3,5 × 4 metros de Terra Sahara"

Razonamiento: Terra Sahara tiene anchos `[2, 3]` y es **solo alfombra**. 3,5 m de ancho > 3 m máximo → no cabe directo. Rotando: 4 × 3,5 → tampoco (sigue siendo > 3 m de ancho). Responder: "Terra Sahara solo se sirve hasta 3 m de ancho como alfombra; para 3,5 m de ancho no es posible en esta colección. ¿Quieres que mire colecciones similares con ancho mayor?"

**Ejemplo 3 — Falta el color**

> Usuario: "Tengo un proyecto y quiero usar Diana Herringbone, ¿qué tenéis?"

Razonamiento: falta el color. Diana Herringbone tiene Denim, Stone, Alpine, Ash, Dove, Heavy Metal. Pregunta: "Diana Herringbone tiene varios colores (Denim, Stone, Alpine, Ash, Dove, Heavy Metal). ¿Cuál te interesa? ¿Y qué medidas necesitas (ancho × largo)?"

**Ejemplo 4 — Sin stock, hay que hablar de fabricación**

> Usuario: "Necesito 25 m de Lara Uni Alpine ancho 4"

Razonamiento: buscar `--ref "Lara Uni Alpine" --ancho 4 --largo 25`. Si no hay **ninguna pieza individual** de ≥25 m en stock, ofrecer: (a) próxima fabricación cuando esté el dato, o (b) alternativas en colección Lara Uni con otro color. Recordar: las piezas no se suman entre sí.

## Notas técnicas para el skill

- Las longitudes en el Excel están en **metros lineales (ML)**. Los anchos también en metros.
- Hay descripciones repetidas con distintos lotes — un mismo producto puede tener varios rollos. Listarlos todos (o los N mejores) es lo correcto.
- El script `buscar_stock.py` es de cero dependencias salvo `openpyxl`. Si no está instalado en el entorno donde corre el skill, instalar con `pip install openpyxl --break-system-packages`.
- El Excel se actualiza periódicamente. Para actualizar el skill basta con reemplazar `data/Piezas terminadas.xlsx` por la nueva versión.
- Cuando exista la API del ERP de Rols, el script principal podrá adaptarse para consultar el endpoint en vez del Excel, manteniendo la misma interfaz hacia el skill.
