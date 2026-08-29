# -*- coding: utf-8 -*-
# Import the four checklist build scripts and emit a unified JSON model.
import importlib.util, json, sys, io, contextlib, tempfile, re, unicodedata

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

# Some historically event-only boosters are distinct sealed pack products rather
# than alternate wrapper art for the normal retail booster.  They remain in the
# main Packs checklist (two copies of each exact pack type), but use explicit
# variants so discovery, pricing, and ownership never conflate them with a
# regular Mirrodin Besieged booster.
EXTRA_PACK_VARIANTS = {
    "Mirrodin Besieged": (
        {"name":"Mirran Faction Pack", "group":"Mirran Faction",
         "variant":"Mirran Faction", "color":"#b5852a", "target":2},
        {"name":"Phyrexian Faction Pack", "group":"Phyrexian Faction",
         "variant":"Phyrexian Faction", "color":"#b5852a", "target":2},
    ),
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
        slots=[]; tags=[]; variants=[]
        if m>0:
            mc=BOX_TYPE.get(ML,C_MAIN)
            label=PRODUCT_LABEL_BY_GROUP[ML]+" Pack"
            tags.append({"t":ML,"c":mc}); variants.append({"name":label,"group":ML,"target":2})
            slots+=[{"l":label+" copy 1","g":ML,"k":MK,"c":mc},{"l":label+" copy 2","g":ML,"k":MK,"c":mc}]
        if st>0:
            label=PRODUCT_LABEL_BY_GROUP["Set"]+" Pack"
            tags.append({"t":"Set","c":C_SET}); variants.append({"name":label,"group":"Set","target":2})
            slots+=[{"l":label+" copy 1","g":"Set","k":"Set","c":C_SET},{"l":label+" copy 2","g":"Set","k":"Set","c":C_SET}]
        if c>0:
            label=PRODUCT_LABEL_BY_GROUP["Collector"]+" Pack"
            tags.append({"t":"Collector","c":C_COLL}); variants.append({"name":label,"group":"Collector","target":2})
            slots+=[{"l":label+" copy 1","g":"Collector","k":"Collector","c":C_COLL},{"l":label+" copy 2","g":"Collector","k":"Collector","c":C_COLL}]
        for extra in EXTRA_PACK_VARIANTS.get(s, ()):
            label=extra["name"]
            group=extra["group"]
            target=extra["target"]
            tags.append({"t":group,"c":extra["color"]})
            variants.append({"name":label,"group":group,"target":target,
                             "pricingVariant":extra["variant"]})
            for copy in range(target):
                # These were not part of the original positional checklist, so
                # historical generic MBS booster progress cannot claim them.
                slots.append({"l":label+" copy "+str(copy+1),"g":group,
                              "k":group,"c":extra["color"],"legacy":None})
        out.append({"name":s,"code":code,"note":note,"est":est,"value":None,
                    "tags":tags,"variants":variants,"slots":slots})
    return out

def prerel_items(rows, era=None):
    out=[]
    for (s,code,yr,nv,est,note) in rows:
        multi = nv>1
        col = GOLD if multi else LP
        names=list(prerel.variant_names(code,nv))
        old_count=prerel.LEGACY_VARIANT_COUNTS.get(code,nv)
        slots=[]
        for i,name in enumerate(names):
            slot={"l":name,"g":"Variant","k":"Variant","c":col}
            if i>=old_count: slot["legacy"]=None
            slots.append(slot)
        tags=[{"t":yr,"c":GREY}]
        if multi: tags.append({"t":"%d variants"%nv,"c":GOLD})
        out.append({"name":s,"code":code,"note":note,"est":est,"value":None,
                    "tags":tags,"variants":names,"slots":slots})
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

PRODUCT_TYPE_BY_GROUP = {
    "Booster": "booster",
    "Draft": "draft_booster",
    "Set": "set_booster",
    "Play": "play_booster",
    "Beyond": "beyond_booster",
    "Epilogue": "epilogue_booster",
    "Theme": "theme_booster",
    "Jumpstart": "jumpstart_booster",
    "JS Vol. 2": "jumpstart_booster",
    "Mystery": "mystery_booster",
    "Collector": "collector_booster",
}

PRODUCT_LABEL_BY_GROUP = {
    "Booster": "Booster",
    "Draft": "Draft Booster",
    "Set": "Set Booster",
    "Play": "Play Booster",
    "Beyond": "Beyond Booster",
    "Epilogue": "Epilogue Booster",
    "Theme": "Theme Booster",
    "Jumpstart": "Jumpstart Booster",
    "JS Vol. 2": "Jumpstart Vol. 2 Booster",
    "Mystery": "Mystery Booster",
    "Collector": "Collector Booster",
}

def _slug(value):
    value=unicodedata.normalize("NFKD",str(value or "")).encode("ascii","ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+","-",value.lower()).strip("-") or "unknown"

def _product_ref(game, item, product_name, product_type, unit, variant=None):
    code=str(item.get("code") or "unknown").lower()
    pieces=[game,code,_slug(item.get("name")),product_type.replace("_","-"),unit]
    if variant: pieces.append(_slug(variant))
    pieces.append("en")
    product_id=":".join(pieces)
    if len(product_id)>200:
        raise ValueError("ProductRef productId exceeds 200 characters: "+product_id)
    return {
        "schema":"tcg.product/v1",
        "productId":product_id,
        "game":game,
        "setCode":item.get("code") or None,
        "setName":item.get("name") or "Unknown set",
        "productName":product_name,
        "productType":product_type,
        "unit":unit,
        "language":"en",
        "variant":variant or None,
    }

def _pricing_record(group, label, ref, static_value=None, slot_ordinal=None):
    record={"slotGroup":group,"label":label,"staticValue":static_value,"ref":ref}
    if slot_ordinal is not None: record["slotOrdinal"]=slot_ordinal
    return record

def attach_pricing_products(checklists):
    """Attach explicit ProductRef v1 identities without touching ownership slots.

    Multiple ownership copies share one pricing product. Rows with distinct sealed
    product groups get one identity per group; prerelease variants get one identity
    per named kit. These records are intentionally excluded from keyFor().
    """
    count=0
    for cl in checklists:
        for era in cl["eras"]:
            for item in era["items"]:
                products=[]
                if cl["id"]=="collector":
                    special=item["name"] in ("Shards of Alara Premium Foil Booster Box","Double Masters VIP Edition Box")
                    product_type="other_sealed" if special else "collector_booster"
                    unit="box" if item["name"]=="Double Masters VIP Edition Box" else "display"
                    product_name=item["name"] if special else item["name"]+" Collector Booster Display"
                    ref=_product_ref("mtg",item,product_name,product_type,unit)
                    products.append(_pricing_record("Display",product_name,ref,item.get("value")))
                elif cl["id"]=="boxes":
                    seen=set()
                    for slot in item.get("slots",[]):
                        group=slot.get("g") or slot.get("l")
                        if group in seen: continue
                        seen.add(group)
                        product_type=PRODUCT_TYPE_BY_GROUP.get(group,"other_sealed")
                        label=PRODUCT_LABEL_BY_GROUP.get(group,group)+" Display"
                        product_name=item["name"]+" "+label
                        ref=_product_ref("mtg",item,product_name,product_type,"display",
                                         group if group=="JS Vol. 2" else None)
                        static=item.get("value") if slot.get("r",True) else None
                        products.append(_pricing_record(group,label,ref,static))
                elif cl["id"]=="packs":
                    seen=set()
                    pricing_variants={variant["group"]:variant.get("pricingVariant")
                                      for variant in item.get("variants",[])}
                    for slot in item.get("slots",[]):
                        group=slot.get("g") or slot.get("l")
                        if group in seen: continue
                        seen.add(group)
                        product_type=PRODUCT_TYPE_BY_GROUP.get(group,"booster")
                        label=PRODUCT_LABEL_BY_GROUP.get(group,group)+" Pack"
                        product_name=item["name"]+" "+label
                        ref=_product_ref("mtg",item,product_name,product_type,"pack",
                                         pricing_variants.get(group) or
                                         (group if group=="JS Vol. 2" else None))
                        products.append(_pricing_record(group,label,ref))
                elif cl["id"]=="prerelease":
                    for si,slot in enumerate(item.get("slots",[])):
                        variant=slot.get("l") or "Standard Prerelease Pack"
                        exact_variant=None if variant=="Standard Prerelease Pack" else variant
                        product_name=(item["name"]+" Prerelease Pack"+
                                      ((" ("+exact_variant+")") if exact_variant else ""))
                        ref=_product_ref("mtg",item,product_name,"prerelease_kit","kit",exact_variant)
                        products.append(_pricing_record("Variant",variant,ref,slot_ordinal=si))
                elif cl["id"] in ("lorcana","lorcana_pre","lorcana_coll"):
                    if cl["id"]=="lorcana":
                        label="Booster Box"; product_type="booster"; unit="display"
                    elif cl["id"]=="lorcana_pre":
                        label="Prerelease Box"; product_type="prerelease_kit"; unit="kit"
                    else:
                        label="Collector Booster Box"; product_type="collector_booster"; unit="display"
                    product_name=item["name"]+" "+label
                    ref=_product_ref("lorcana",item,product_name,product_type,unit)
                    products.append(_pricing_record("Copies",label,ref,item.get("value")))
                item["pricingProducts"]=products
                count+=len(products)
    return count

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
   dict(build("packs","MTG Booster Packs",
         "Two of every booster pack, for every set — one pair per pack type that set was sold in. "
         "Open details on sets with multiple pack types to adjust each named type independently. Optional wrapper artwork checklists live inside matching row details and do not affect completion.",
         packs.ERAS, pack_items), progressMode="group_variants"),
   dict(build("prerelease","MTG Prerelease Packs",
         "One of every distinct sealed prerelease pack or kit variant. Named guild, clan, faction, color, character, and college versions each count once; duplicate copies are tracked but do not increase completion. "
         "Retail kits begin with Return to Ravnica (2012), with Mirrodin Besieged faction packs as a verified exception.",
         prerel.ERAS, prerel_items), progressMode="distinct_variants"),
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
pricing_product_count=attach_pricing_products(data["checklists"])

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
print("pricing products=",pricing_product_count)
print("wrote data:", ", ".join(os.path.relpath(t,ROOT) for t in targets))
