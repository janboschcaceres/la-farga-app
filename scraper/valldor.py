"""Saca los datos de La Farga FC de la web de Fundació Valldor7 y genera data/liga.json.
Uso: python3 -I valldor.py <carpeta_salida_html> <liga.json>
Pide 3 páginas (equipo, clasificación y resultados del grupo), con pausa entre ellas."""
import html, json, re, sys, time, urllib.request, datetime, os

BASE = "https://virtual.fundaciovalldor7.com/cornella-hospitalet-f7-es-26-27"
EQUIPO_ID, ROUND, GROUP = 4497, 593, 2042
EQUIPO = "La Farga FC"
CAMPOS = {"O. Ildefons": "UE Sant Ildefons (Cornellà)", "L. Almeda": "CD Almeda (Cornellà)", "Promosportive": "Promosportive (L'Hospitalet)"}
# Apodo y dorsal de la camiseta (pedido de equipaciones). BILI es el portero, sin camiseta en el pedido.
APODOS = {"Jan Bosch": ("BLXDY", "11"), "Jefersson": ("MENDO", "69"), "Unai Aixeres": ("NA1XE", "22"),
          "Biel Gilavert": ("BILI", "13"), "Joan López": ("JOTA", "8"), "Ferran Baltà": ("BALTA", "66"),
          "Adria Pastor": ("AP7", "77"), "Victor Benito": ("BENITO", "6"), "Joel López": ("JOWI", "99"),
          "Igor": ("IGOR", "2"), "Marcel Rebollar": ("MARCELO", "10")}
# Jugadores que no salen en la ficha de Valldor
EXTRA = [{"id": "x-solde", "apodo": "SOLDE", "camiseta": "9", "dorsal": "9", "nombre": "SOLDE", "posicion": "", "extra": True, "invitado": True}]  # no es del equipo: solo cuenta en goleadores
POS = {"POR": "Portero", "CAR": "Carrilero", "DEF": "Defensa", "MED": "Medio", "DEL": "Delantero"}

def get(url, path):
    with urllib.request.urlopen(url, timeout=30) as r:
        s = r.read().decode("utf-8")
    open(path, "w").write(s)
    time.sleep(1)
    return s

def tokens(s):
    s = re.sub(r"(?s)<(script|style).*?</\1>", "", s)
    t = html.unescape(re.sub(r"<[^>]+>", "\n", s))
    return [re.sub(r"\s+", " ", l).strip() for l in t.split("\n") if l.strip()]

def fecha(d):
    return datetime.datetime.strptime(d, "%d.%m.%Y").date().isoformat() if re.match(r"\d\d\.\d\d\.\d{4}$", d) else ""

ICONOS = {"soccer-ball": "gol", "yellow-card": "amarilla", "red-card": "roja", "yellow-red-card": "roja",
          "own-goal": "propia", "soccer-ball-own": "propia", "penalty": "gol"}

def acta(s):
    """Eventos (minuto, lado, jugador, tipo) y alineaciones de la página de un partido."""
    ev = []
    if "Eventos del partido" in s:
        i = s.index("Eventos del partido"); blk = s[i:s.index("</table>", i)]
        for tr in re.findall(r"(?s)<tr.*?</tr>", blk):
            tds = re.findall(r"(?s)<td.*?</td>", tr)
            if len(tds) != 3: continue
            minuto = re.sub(r"<[^>]+>|\s", "", tds[1]).replace("’", "")
            for lado, td in (("local", tds[0]), ("visitante", tds[2])):
                ic = re.search(r"icon-svg icon-([a-z-]+)", td)
                nom = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", td))).strip()
                if ic and nom:
                    ev.append({"min": minuto, "lado": lado, "jugador": nom, "tipo": ICONOS.get(ic.group(1), ic.group(1))})
    al = []
    for w in s.split('widget-lineup-table')[1:3]:
        eq = html.unescape(re.search(r"<h4>(.*?)</h4>", w).group(1)).strip()
        jug, no = w.split("No juegan")[0], (w.split("No juegan")[1] if "No juegan" in w else "")
        fila = lambda b: [{"num": n.lstrip("0") or "0", "pos": p, "nombre": re.sub(r"\s+", " ", html.unescape(x)).strip()}
                          for n, p, x in re.findall(r'(?s)lineup__num">(.*?)</td>.*?lineup__pos[^>]*>(.*?)</td>.*?lineup__name">(.*?)</td>', b)]
        al.append({"equipo": eq, "juegan": fila(jug), "no_juegan": fila(no)})
    return {"eventos": ev, "alineaciones": al}

def partidos_de(tk):
    """Recorre tokens del bloque de partidos: local, (marcador|estado), fecha, [campo], visitante."""
    out, i = [], 0
    while i < len(tk):
        if i + 1 < len(tk) and tk[i + 1] == "()":  # jugado: local () gf - gc ()
            loc, gf, gc, i = tk[i], tk[i + 2], tk[i + 4], i + 6
            estado = "jugado"; hora = ""
        elif i + 1 < len(tk) and (re.match(r"\d\d:\d\d$", tk[i + 1]) or tk[i + 1] in ("aplazado", "pendiente", "suspendido")):
            loc, gf, gc, estado, i = tk[i], None, None, tk[i + 1], i + 2
            hora = estado if ":" in estado else ""
            if hora: estado = "pendiente"
        else:
            i += 1; continue
        f = fecha(tk[i]); i += 1
        campo = ""
        if i < len(tk) and tk[i] == "-":  # - Campo - Pista Campo - Pista
            campo = tk[i + 1]; pista = tk[i + 3]; i += 7
            campo = f"{CAMPOS.get(campo, campo)} · {pista}"
        vis = tk[i]; i += 1
        out.append({"local": loc, "visitante": vis, "gf": gf, "gc": gc, "estado": estado, "fecha": f, "hora": hora, "campo": campo})
    return out

def leer_plantilla(raw):
    """Plantilla desde la tabla HTML de una página de equipo."""
    out = []
    for tr in re.findall(r"(?s)<tr>\s*<td class=\"team-roster-table__number\">.*?</tr>", raw):
        c = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", x))).strip() for x in re.findall(r"(?s)<td[^>]*>(.*?)</td>", tr)]
        if len(c) < 8: continue
        d, pos, nom, edad, pj, g, a, r = c[:8]
        if nom.isupper(): nom = nom.title()
        num = lambda v: int(v) if v.isdigit() else 0
        out.append({"id": f"v{d}", "dorsal": d, "posicion": POS.get(pos, pos), "nombre": nom,
                    "edad": int(edad) if edad.isdigit() else None, "pj": num(pj), "goles": num(g), "amarillas": num(a), "rojas": num(r)})
    return out

def plantilla_ap(j):
    ap = next((v for k, v in APODOS.items() if k in j["nombre"]), None)
    if ap: j["apodo"], j["camiseta"] = ap

def main(outdir, dest):
    os.makedirs(outdir, exist_ok=True)
    eq = tokens(get(f"{BASE}/equipo/{EQUIPO_ID}", f"{outdir}/equipo.html"))
    cl = tokens(get(f"{BASE}/clasificacion?roundId={ROUND}&groupId={GROUP}", f"{outdir}/clas.html"))
    rs = tokens(get(f"{BASE}/resultados?roundId={ROUND}&groupId={GROUP}", f"{outdir}/res.html"))

    # Clasificación: pos, equipo, pts, j, g, e, p, gf, gc, dg
    i = cl.index("DG") + 1; clas = []
    while i + 9 < len(cl) and re.match(r"\d\d$", cl[i]):
        p, e, *n = cl[i:i + 10]
        clas.append({"pos": int(p), "equipo": e, "pts": int(n[0]), "pj": int(n[1]), "g": int(n[2]), "e": int(n[3]),
                     "p": int(n[4]), "gf": int(n[5]), "gc": int(n[6]), "dg": int(n[7].replace(" ", ""))})
        i += 10

    plantilla = leer_plantilla(open(f"{outdir}/equipo.html").read())
    for j in plantilla:
        plantilla_ap(j)

    plantilla += [e for e in EXTRA if e["apodo"] not in {p.get("apodo") for p in plantilla}]

    # Calendario de La Farga (con jornada) desde la página del equipo
    c0, c1 = eq.index("Calendario", eq.index("Plantilla", eq.index("Últimos resultados"))), eq.index("Galería de fotos")
    cal = eq[c0 + 1:c1]; partidos = []
    for k, t in enumerate(cal):
        m = re.search(r"Jornada (\d+)$", t)
        if not m: continue
        nxt = next((j for j in range(k + 1, len(cal)) if "Jornada" in cal[j]), len(cal))
        blk = cal[k + 1:nxt]
        if "descansa" in blk:
            partidos.append({"id": f"j{m.group(1)}", "jornada": int(m.group(1)), "descansa": True, "fecha": "", "rival": "Descansa"}); continue
        for p in partidos_de(blk):
            local = p["local"] == EQUIPO
            partidos.append({"id": f"j{m.group(1)}", "jornada": int(m.group(1)), "rival": p["visitante"] if local else p["local"],
                             "local": local, "fecha": p["fecha"], "hora": p["hora"], "campo": p["campo"], "estado": p["estado"],
                             "gf": (p["gf"] if local else p["gc"]), "gc": (p["gc"] if local else p["gf"])})
    # Id del acta de cada jornada (onclick del calendario de la página del equipo)
    raw = open(f"{outdir}/equipo.html").read(); raw = raw[raw.index('id="tabCalendar"'):]
    ids = {}
    for m in re.finditer(r'Jornada (\d+)', raw):
        nxt = re.search(r"partido/(\d+)", raw[m.end():m.end() + 6000])
        nj = re.search(r"Jornada \d+", raw[m.end():])
        if nxt and (not nj or nxt.start() < nj.start()): ids.setdefault(int(m.group(1)), nxt.group(1))
    for p in partidos:
        if p.get("descansa"): continue
        p["acta"] = ids.get(p["jornada"])
        if p["acta"] and p.get("estado") == "jugado":
            a = acta(get(f"{BASE}/partido/{p['acta']}", f"{outdir}/partido-{p['acta']}.html"))
            nuestro = "local" if p["local"] else "visitante"
            for e in a["eventos"]:
                e["nuestro"] = e["lado"] == nuestro
                e["jugador_id"] = next((j["id"] for j in plantilla if e["nuestro"] and j["nombre"].startswith(e["jugador"].split(" ")[0])
                                        and all(w in j["nombre"] for w in e["jugador"].split(" ")[:2])), None)
            p["eventos_web"] = a["eventos"]
            al = {x["equipo"]: x for x in a["alineaciones"]}
            p["convocados"] = [x["nombre"] for x in al.get(EQUIPO, {}).get("juegan", [])]
            p["no_juegan"] = [x["nombre"] for x in al.get(EQUIPO, {}).get("no_juegan", [])]
            p["rival_alineacion"] = [x["nombre"] for x in al.get(p["rival"], {}).get("juegan", [])]

    # Horas y campos los da mejor la página de resultados del grupo
    grupo = partidos_de(rs[rs.index("UE Sant Ildefons - Cornellà") + 1:])
    for p in partidos:
        g = next((x for x in grupo if x["fecha"] == p.get("fecha") and EQUIPO in (x["local"], x["visitante"])), None)
        if g:
            p["hora"] = g["hora"] or p.get("hora", ""); p["campo"] = g["campo"] or p.get("campo", "")

    # Rivales: plantilla de cada equipo del grupo
    raw_cl = open(f"{outdir}/clas.html").read()
    ids_eq = dict((html.unescape(n).strip(), i) for i, n in re.findall(r'equipo/(\d+)">([^<]+)<', raw_cl) if n.strip())
    rivales = {}
    for nombre, tid in ids_eq.items():
        if nombre == EQUIPO: continue
        try:
            rivales[nombre] = {"id": tid, "plantilla": leer_plantilla(get(f"{BASE}/equipo/{tid}", f"{outdir}/equipo-{tid}.html"))}
        except Exception as e:
            print("No se pudo leer", nombre, e)
    # Sanciones de jugadores de equipos del grupo
    st = tokens(get(f"{BASE}/sancionados", f"{outdir}/sanc.html")); sanciones = []
    if "Motivo" in st:
        i = st.index("Motivo") + 1; grupo_eq = set(ids_eq)
        while i + 3 < len(st) and re.match(r"\d+$", st[i + 2]):
            if st[i + 1] in grupo_eq:
                sanciones.append({"jugador": st[i], "equipo": st[i + 1], "partidos": int(st[i + 2]), "motivo": st[i + 3]})
            i += 4

    data = {"equipo": EQUIPO, "competicion": "F7 Baix Llobregat (Cornellà–Hospitalet) 2026-27", "grupo": "Viernes - B",
            "fase": "Primer Split", "fuente": f"{BASE}/equipo/{EQUIPO_ID}", "actualizado": datetime.date.today().isoformat(), "actualizado_ts": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "clasificacion": clas, "plantilla": plantilla,
            "partidos": sorted([p for p in partidos if not p.get("descansa")], key=lambda p: p["fecha"]),
            "descansos": sorted(p["jornada"] for p in partidos if p.get("descansa")),
            "grupo_partidos": grupo, "rivales": rivales, "sanciones": sanciones}
    json.dump(data, open(dest, "w"), ensure_ascii=False, indent=2)
    print(f"{len(clas)} equipos, {len(plantilla)} jugadores, {len(data['partidos'])} partidos, {len(grupo)} partidos del grupo")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
