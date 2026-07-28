# -*- coding: utf-8 -*-
# Import the four checklist build scripts and emit a unified JSON model.
import importlib.util, json, sys, io, contextlib, tempfile

def load(mod_name, path):
    spec = importlib.util.spec_from_file_location(mod_name, path)
    mod = importlib.util.module_from_spec(spec)
    # silence their print()/PDF build output
    with contextlib.redirect_stdout(io.StringIO()):
        spec.loader.exec_module(mod)
    return mod

import os
# Paths resolve from THIS file's location, so the project runs from any folder and
# in either layout: flat (everything beside this script) or the handoff layout
# (generators/ + data/ + apps/static/). Never hardcode an absolute path here.
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE) if os.path.basename(HERE) == "generators" else HERE
_d   = os.path.join(ROOT, "data")
DATA_DIR = _d if os.path.isdir(_d) else HERE
base = HERE + os.sep                      # where the build_*.py modules live
# The PDF modules render on import. Import them from a temporary working directory
# so `gen_data.py` updates JSON only instead of leaving duplicate PDFs in generators/.
with tempfile.TemporaryDirectory(prefix="tcg-binder-gen-") as import_tmp:
    old_cwd=os.getcwd()
    os.chdir(import_tmp)
    try:
        collector = load("m_collector", base+"build_pdf2.py")    # (set,code,type,value,est,note)
        boxes     = load("m_boxes",     base+"build_box.py")      # (set,code,boxtype,value,est,note)
        packs     = load("m_packs",     base+"build_packs2.py")   # (set,code,main,set_,coll,est,note)
        prerel    = load("m_prerel",    base+"build_prerelease.py")# (set,code,year,variants,est,note)
        lorcana   = load("m_lorcana",   base+"build_lorcana.py")   # (name,code,date,mb,kb,eb,mp,kp,ep,coll,note)
    finally:
        os.chdir(old_cwd)

# color palettes
COL_TYPE = {"Standard":"#4a7c59","Reprint":"#b5852a","Univ. Beyond":"#9c3d54","Special":"#5566aa"}
BOX_TYPE = {"Booster":"#2f7d8c","Draft":"#6a4fb0","Set":"#b5852a","Play":"#4a7c59","Beyond":"#9c3d54",
            "Jumpstart":"#c0562a","JS Vol. 2":"#c0562a","Theme":"#8a6f45",
            "Epilogue":"#5566aa","Mystery":"#5566aa"}
C_MAIN="#6a4fb0"; C_SET="#b5852a"; C_COLL="#9c3d54"; LP="#6a4fb0"; GREY="#7a7a7a"; GOLD="#b5852a"

def collector_items(rows, era=None):
    out=[]
    for (s,code,typ,val,est,note) in rows:
        out.append({"name":s,"code":code,"note":note,"est":est,
                    "value":("~$"+val.lstrip("$")) if est and val not in("NA","TBA") else (val if val not in("NA","TBA") else ("—" if val=="NA" else "TBA")),
                    "tags":[{"t":typ,"c":COL_TYPE.get(typ,LP)}],
                    "slots":[{"l":"Display","g":"Display","c":LP}]})
    return out

def _box_value(val, est):
    if val=="NA": return "—"
    if val=="TBA": return "TBA"
    return ("~"+val) if est else val

def box_item(row, products, legacy_key=None, required_product=None, bonus_note=None):
    """Build one booster-display row.

    ``legacy_key`` pins the required slot to its position in the original
    all-in-one checklist.  That lets the web presentation move rows between
    sections without changing the v1 -> v2 migration target.  Optional slots
    deliberately use ``legacy: None`` because they did not exist in v1.
    """
    s,code,bt,val,est,note = row
    slots=[]
    for product in products:
        required = product == required_product
        slots.append({"l":product+" Box", "g":product,
                      "k":"Box" if required else product,
                      "r":required, "legacy":legacy_key if required else None,
                      "c":BOX_TYPE.get(product,LP)})
    return {"name":s,"code":code,
            "note":bonus_note if bonus_note is not None else note,
            "est":False if bonus_note is not None else est,
            "value":None if bonus_note is not None else _box_value(val,est),
            "tags":[{"t":products[0],"c":BOX_TYPE.get(products[0],LP)}],
            "slots":slots}

def box_items(rows, era=None):
    out=[]
    for (s,code,bt,val,est,note) in rows:
        products = boxes.BOX_PRODUCTS.get(s, (bt,))
        if not products or products[0] != bt:
            raise ValueError("BOX_PRODUCTS must start with required type %s for %s" % (bt,s))
        out.append(box_item((s,code,bt,val,est,note), products,
                            required_product=bt))
    return out

SPECIALTY_BONUS_PRODUCTS = ("Theme", "Jumpstart", "JS Vol. 2")
MOVED_REQUIRED_SECTIONS = {
    "March of the Machine: Aftermath": "Epilogue Booster Display — 2023",
    "Ravnica Remastered": "Draft Holdover — Ravnica Remastered (2024)",
    "Assassin's Creed": "Beyond Booster Display — 2024",
}

def box_eras():
    """Keep common columns together and move sparse products to focused eras.

    Mainline eras never need more than Draft + Set columns.  Theme and the two
    set-attached Jumpstart forms are bonus-only inventory sections; unusually
    named required displays (Epilogue, Beyond, and RVR's Draft holdover) get
    their own one-column sections.
    """
    regular=[]
    moved={name:[] for name in MOVED_REQUIRED_SECTIONS.values()}
    specialty={product:[] for product in SPECIALTY_BONUS_PRODUCTS}

    for ei,(era_name,rows) in enumerate(boxes.ERAS):
        core=[]
        for ii,row in enumerate(rows):
            s,code,bt,val,est,note=row
            products=boxes.BOX_PRODUCTS.get(s,(bt,))
            if not products or products[0] != bt:
                raise ValueError("BOX_PRODUCTS must start with required type %s for %s" % (bt,s))
            legacy="boxes|%d|%d|0" % (ei,ii)

            core_products=tuple(p for p in products
                                if p == bt or p not in SPECIALTY_BONUS_PRODUCTS)
            item=box_item(row,core_products,legacy_key=legacy,required_product=bt)
            section=MOVED_REQUIRED_SECTIONS.get(s)
            if section: moved[section].append(item)
            else: core.append(item)

            for product in products:
                if product == bt or product not in SPECIALTY_BONUS_PRODUCTS: continue
                label={
                    "Theme":"Optional Theme Booster display; bonus inventory only.",
                    "Jumpstart":"Optional set-attached Jumpstart display; bonus inventory only.",
                    "JS Vol. 2":"Optional second Lord of the Rings Jumpstart volume; bonus inventory only.",
                }[product]
                specialty[product].append(box_item(row,(product,),
                    required_product=None,bonus_note=label))

        if core: regular.append({"name":era_name,"items":core})

        # Keep the unusual required products beside their chronological era.
        if era_name.startswith("Draft & Set Booster Era"):
            regular.append({"name":"Epilogue Booster Display — 2023",
                            "items":moved["Epilogue Booster Display — 2023"]})
        if era_name.startswith("Play Booster Era"):
            regular.insert(len(regular)-1,
                {"name":"Draft Holdover — Ravnica Remastered (2024)",
                 "items":moved["Draft Holdover — Ravnica Remastered (2024)"]})
            regular.append({"name":"Beyond Booster Display — 2024",
                            "items":moved["Beyond Booster Display — 2024"]})
        if era_name.startswith("Jumpstart Boxes"):
            regular.extend([
                {"name":"Bonus Theme Booster Displays — 2018–2022",
                 "items":specialty["Theme"]},
                {"name":"Bonus Set-Attached Jumpstart Displays — 2022–2023",
                 "items":specialty["Jumpstart"]},
                {"name":"Bonus Jumpstart Vol. 2 Display — 2023",
                 "items":specialty["JS Vol. 2"]},
            ])
    return regular

PACK_MAIN_OVERRIDES = {
    # (truthful visible group, historical key group) — the second value keeps
    # already-saved v2 progress stable after correcting the old era-wide label.
    "Ravnica Remastered": ("Draft", "Play"),
    "March of the Machine: Aftermath": ("Epilogue", "Draft"),
    "Assassin's Creed": ("Beyond", "Play"),
    "Mystery Booster — Convention Ed.": ("Mystery", "Booster"),
    "Mystery Booster — Retail Ed.": ("Mystery", "Booster"),
    "Mystery Booster — Convention Ed. (2021)": ("Mystery", "Booster"),
    "Mystery Booster 2": ("Mystery", "Booster"),
}

def main_pack_label(era, set_name=None):
    """What the *standard* pack was actually called in that era. Tagging a 1994
    pack 'Draft/Play' was wrong — Draft Boosters arrive 2019, Play Boosters 2024."""
    if set_name in PACK_MAIN_OVERRIDES: return PACK_MAIN_OVERRIDES[set_name][0]
    e = (era or "").lower()
    if "upcoming" in e: return "Play"
    if "play"     in e: return "Play"
    if "draft"    in e: return "Draft"
    return "Booster"

def pack_items(rows, era=None):
    out=[]
    for (s,code,m,st,c,est,note) in rows:
        ML = main_pack_label(era,s)
        MK = PACK_MAIN_OVERRIDES.get(s,(ML,ML))[1]
        slots=[]; tags=[]
        if m>0:
            mc=BOX_TYPE.get(ML,C_MAIN)
            tags.append({"t":ML,"c":mc}); slots+=[{"l":ML+" #1","g":ML,"k":MK,"c":mc},{"l":ML+" #2","g":ML,"k":MK,"c":mc}]
        if st>0:
            tags.append({"t":"Set","c":C_SET}); slots+=[{"l":"Set #1","g":"Set","c":C_SET},{"l":"Set #2","g":"Set","c":C_SET}]
        if c>0:
            tags.append({"t":"Collector","c":C_COLL}); slots+=[{"l":"Collector #1","g":"Collector","c":C_COLL},{"l":"Collector #2","g":"Collector","c":C_COLL}]
        out.append({"name":s,"code":code,"note":note,"est":est,"value":None,"tags":tags,"slots":slots})
    return out

def prerel_items(rows, era=None):
    out=[]
    for (s,code,yr,nv,est,note) in rows:
        multi = nv>1
        col = GOLD if multi else LP
        slots=[{"l":"Variant %d"%(i+1),"g":"Variant","c":col} for i in range(nv)]
        tags=[{"t":yr,"c":GREY}]
        if multi: tags.append({"t":"%d variants"%nv,"c":GOLD})
        out.append({"name":s,"code":code,"note":note,"est":est,"value":None,"tags":tags,"slots":slots})
    return out

def build(checklist_id, title, sub, eras, item_fn):
    return {"id":checklist_id,"title":title,"sub":sub,
            "eras":[{"name":name,"items":item_fn(rows,name)} for (name,rows) in eras]}

def attach_product_images(checklists):
    """Attach curated sealed-product images without making them state identity.

    Image metadata is deliberately row decoration: adding, removing, or replacing
    an image must never change a saved progress key.
    """
    path=os.path.join(DATA_DIR,"product_images.json")
    if not os.path.exists(path): return 0
    with open(path,encoding="utf-8") as f:
        records=json.load(f).get("images",[])
    attached=0
    for cl in checklists:
        for era in cl["eras"]:
            for item in era["items"]:
                keys={slot.get("k") or slot.get("g") or slot.get("l")
                      for slot in item.get("slots",[])}
                found=[rec for rec in records
                       if rec.get("checklist")==cl["id"]
                       and rec.get("code")==item.get("code")
                       and rec.get("name")==item.get("name")
                       and rec.get("slot_key") in keys]
                if found:
                    item["images"]=[{"url":rec["url"],"caption":rec["caption"],
                                     "source":rec["source"]} for rec in found]
                    attached+=len(found)
    return attached

K1="#1d9e75"; K2="#9c3d54"  # kid 1 teal, kid 2 magenta
C_COLLB="#9c3d54"
def _lor_money(m,k,est):
    if m is None: return None
    mk = "TBA" if k=="TBA" else ("~$"+format(k,",") if est else "$"+format(k,","))
    return "$%s / %s" % (format(m,","), mk)

def lorcana_items(rows, kind="box"):
    """kind: box | pre | coll — each becomes its own tab so the checkbox
    columns are never ambiguous."""
    out=[]
    for (s,code,dt,mb,kb,eb,mp,kp,ep,hc,note) in rows:
        if kind=="pre" and mp is None: continue
        if kind=="coll" and not hc:   continue
        # The product type is the tab you're on — don't repeat it on every row.
        # The one thing the row can't tell you is which kid, so label that.
        slots=[{"l":"Kid 1","g":"Kid 1","c":K1},{"l":"Kid 2","g":"Kid 2","c":K2}]
        if kind=="box":    val=_lor_money(mb,kb,eb); est=eb
        elif kind=="pre":  val=_lor_money(mp,kp,ep); est=ep
        else:              val=None; est=True
        out.append({"name":s,"code":code,"note":note,"est":est,"value":val,
                    "tags":[{"t":dt,"c":"#7a7a7a"}],"slots":slots})
    return out

def _lor_era(name):
    """The combined PDF's era heading carries a parenthetical about which
    products exist when — meaningless once each product has its own tab."""
    return name.split("(")[0].strip()

def lorcana_eras(kind):
    """Drop eras that end up empty for this kind."""
    out=[]
    for (name,rows) in lorcana.ERAS:
        items=lorcana_items(rows,kind)
        if items: out.append({"name":_lor_era(name),"items":items})
    return out

GEN = "July 2026"
data = {
 "generated":GEN,
 "checklists":[
   build("collector","MTG Collector Boxes",
         "One of every Collector Booster display ever released, plus the premium all-foil and VIP boxes that sit alongside them — one per set. "
         "Values are current market, "+GEN+".",
         collector.ERAS, collector_items),
   {"id":"boxes","title":"MTG Booster Boxes",
    "sub":"The goal is one preferred non-Collector randomized booster display per set or materially distinct edition, 1993–2026. "
          "Other non-Collector display types are grouped into focused bonus sections: track any quantity, but they do not affect completion.",
    "eras":box_eras()},
   build("packs","MTG Booster Packs",
         "Two of every booster pack, for every set — one pair per pack type that set was sold in. "
         "Wrapper art variants are not tracked separately.",
         packs.ERAS, pack_items),
   build("prerelease","MTG Prerelease Packs",
         "One of every prerelease pack variant. Retail prerelease kits begin with Return to Ravnica (2012); "
         "earlier sets held prerelease events but sold no boxed product.",
         prerel.ERAS, prerel_items),
   {"id":"lorcana","title":"Lorcana Booster Boxes",
    "sub":"One sealed booster box per kid — two of every Lorcana set. "
          "Values are shown as MSRP / market; market is what you will actually pay.",
    "eras":lorcana_eras("box")},
   {"id":"lorcana_pre","title":"Lorcana Prerelease Boxes",
    "sub":"One prerelease box per kid. Retail prerelease boxes only begin with Wilds Unknown (Set 12, May 2026); "
          "earlier sets had events only.",
    "eras":lorcana_eras("pre")},
   {"id":"lorcana_coll","title":"Lorcana Collector Boxes",
    "sub":"One collector booster box per kid. Lorcana's first Collector Boosters arrive with Into the Inkdark (Set 15, Q1 2027).",
    "eras":lorcana_eras("coll")},
 ]
}
image_count=attach_product_images(data["checklists"])

targets=[os.path.join(DATA_DIR,"binder_data.json")]
node_data=os.path.join(ROOT,"node-app","data")
if os.path.isdir(node_data):
    targets.append(os.path.join(node_data,"binder_data.json"))
for target in targets:
    with open(target,"w") as f:
        json.dump(data,f,ensure_ascii=False)

# quick stats
for cl in data["checklists"]:
    tot=sum(sum(1 for sl in it["slots"] if sl.get("r",True)) for e in cl["eras"] for it in e["items"])
    inv=sum(len(it["slots"]) for e in cl["eras"] for it in e["items"])
    items=sum(len(e["items"]) for e in cl["eras"])
    print(cl["id"], "items=",items, "required=",tot, "inventory_slots=",inv)
print("OK")
print("trusted product images=",image_count)
print("wrote data:", ", ".join(os.path.relpath(t,ROOT) for t in targets))
