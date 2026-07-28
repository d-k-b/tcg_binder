# -*- coding: utf-8 -*-
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, Flowable, KeepTogether,
                                NextPageTemplate)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

PURPLE = colors.HexColor("#3a2d6b")
LPURPLE = colors.HexColor("#6a4fb0")
HEADBG = colors.HexColor("#ece8f7")
ROWALT = colors.HexColor("#faf9fd")
GRID = colors.HexColor("#e4e0ef")
AMBER = colors.HexColor("#b5852a")
GREY = colors.HexColor("#666666")
# box-type colors
B_BOOST = colors.HexColor("#2f7d8c")  # classic Booster
B_DRAFT = colors.HexColor("#6a4fb0")  # Draft Booster
B_PLAY  = colors.HexColor("#4a7c59")  # Play Booster
B_SET   = colors.HexColor("#b5852a")  # Set Booster
B_BEY   = colors.HexColor("#9c3d54")  # UB Beyond Booster
B_JUMP  = colors.HexColor("#c0562a")  # Jumpstart (separate card pool)
B_THEME = colors.HexColor("#8a6f45")  # Theme Booster display
B_SPECIAL = colors.HexColor("#5566aa") # Epilogue / Mystery displays
TYPECOLOR = {"Booster":B_BOOST, "Draft":B_DRAFT, "Set":B_SET, "Play":B_PLAY, "Beyond":B_BEY,
             "Jumpstart":B_JUMP, "JS Vol. 2":B_JUMP, "Theme":B_THEME,
             "Epilogue":B_SPECIAL, "Mystery":B_SPECIAL}

styles = getSampleStyleSheet()
cell = ParagraphStyle("cell", parent=styles["Normal"], fontSize=7.0, leading=8.2)
cell_b = ParagraphStyle("cellb", parent=cell, fontName="Helvetica-Bold")
cell_code = ParagraphStyle("code", parent=cell, textColor=GREY, fontSize=6.6)
cell_note = ParagraphStyle("note", parent=cell, fontSize=6.3, textColor=colors.HexColor("#555555"), leading=7.6)
val_st = ParagraphStyle("val", parent=cell, fontName="Helvetica-Bold", alignment=2, fontSize=7.0)
val_est = ParagraphStyle("vale", parent=val_st, textColor=AMBER)
val_tba = ParagraphStyle("vtba", parent=val_st, textColor=colors.HexColor("#9a9a9a"), fontName="Helvetica-Oblique")
era_st = ParagraphStyle("era", parent=styles["Normal"], fontSize=9, textColor=colors.white, fontName="Helvetica-Bold", leading=10.5)
hdr_cell = ParagraphStyle("hc", parent=styles["Normal"], fontSize=5.8, fontName="Helvetica-Bold", textColor=PURPLE)
note_box_st = ParagraphStyle("nb", parent=styles["Normal"], fontSize=6.6, leading=9.2, textColor=colors.HexColor("#333333"))
foot_st = ParagraphStyle("foot", parent=styles["Normal"], fontSize=6, textColor=colors.HexColor("#888888"), leading=8)

class Checkbox(Flowable):
    def __init__(self, size=7.5):
        super().__init__(); self.size=size; self.width=size; self.height=size
    def draw(self):
        self.canv.setStrokeColor(LPURPLE); self.canv.setLineWidth(1)
        self.canv.roundRect(0,0,self.size,self.size,1.2,stroke=1,fill=0)

class Tag(Flowable):
    def __init__(self, text, color, w=40, h=9.5):
        super().__init__(); self.text=text; self.color=color; self.width=w; self.height=h
    def draw(self):
        c=self.canv; c.setFillColor(self.color)
        c.roundRect(0,0,self.width,self.height,4,stroke=0,fill=1)
        c.setFillColor(colors.white); c.setFont("Helvetica-Bold",5.3)
        c.drawCentredString(self.width/2.0,2.5,self.text)

def tag_for(t): return Tag(t, TYPECOLOR[t])

# (set, code, boxtype, value, est, note)   value "NA"->dash, "TBA"->tba
ERAS = [
("The Beginning — 1993–1995", [
 ("Limited Edition Alpha","LEA","Booster","NA",False,"No true sealed box exists (museum-tier)"),
 ("Limited Edition Beta","LEB","Booster","NA",False,"No true sealed box exists (museum-tier)"),
 ("Unlimited Edition","2ED","Booster","$100k+",True,"Sticker-sealed; extremely rare"),
 ("Arabian Nights","ARN","Booster","$200k+",True,"~$250k at Heritage 2024; very rare"),
 ("Antiquities","ATQ","Booster","$30,000",True,"Very rare artifact set"),
 ("Revised Edition (3rd)","3ED","Booster","$8,565",False,"First dual lands"),
 ("Legends","LEG","Booster","$6,881",False,"First legendary creatures"),
 ("The Dark","DRK","Booster","$3,178",False,"Scarce 4th expansion"),
 ("Fallen Empires","FEM","Booster","$400",True,"Heavily overprinted; cheap"),
 ("Fourth Edition","4ED","Booster","$1,200",True,"Large core set"),
 ("Ice Age","ICE","Booster","$900",True,"Start of Ice Age block"),
 ("Chronicles","CHR","Booster","$500",True,"Reprint set"),
 ("Homelands","HML","Booster","$300",True,"Overprinted"),
 ("Alliances","ALL","Booster","$1,000",True,"Ice Age block"),
]),
("Rath, Urza & Portal — 1996–1999", [
 ("Mirage","MIR","Booster","$1,500",True,"Mirage block opener"),
 ("Visions","VIS","Booster","$1,200",True,"Mirage block"),
 ("Fifth Edition","5ED","Booster","$700",True,"Largest core set"),
 ("Weatherlight","WTH","Booster","$900",True,"End of Mirage block"),
 ("Tempest","TMP","Booster","$2,383",False,"Classic combo staples"),
 ("Stronghold","STH","Booster","$2,710",False,"Sliver Queen, Grave Pact"),
 ("Exodus","EXO","Booster","$900",True,"End of Tempest block"),
 ("Portal","POR","Booster","$600",True,"Beginner-market set"),
 ("Unglued","UGL","Booster","$1,200",True,"First Un-set"),
 ("Urza's Saga","USG","Booster","$6,025",False,"Gaea's Cradle; iconic"),
 ("Portal Second Age","PO2","Booster","$450",True,"Beginner-market set"),
 ("Urza's Legacy","ULG","Booster","$3,107",False,"Grim Monolith, Memory Jar"),
 ("Sixth Edition","6ED","Booster","$700",True,"New-rules core set"),
 ("Urza's Destiny","UDS","Booster","$3,603",False,"Yawgmoth's Bargain"),
 ("Portal Three Kingdoms","PTK","Booster","$2,250",False,"Asia-only; very scarce"),
 ("Mercadian Masques","MMQ","Booster","$700",True,"Masques block opener"),
]),
("Masques to Onslaught — 2000–2003", [
 ("Nemesis","NEM","Booster","$500",True,"Masques block"),
 ("Prophecy","PCY","Booster","$400",True,"Weakest Masques set"),
 ("Invasion","INV","Booster","$700",True,"Multicolor block"),
 ("Planeshift","PLS","Booster","$400",True,"Invasion block"),
 ("Apocalypse","APC","Booster","$500",True,"End of Invasion block"),
 ("Seventh Edition","7ED","Booster","$2,350",False,"First foils in core set"),
 ("Odyssey","ODY","Booster","$500",True,"Graveyard block"),
 ("Torment","TOR","Booster","$400",True,"Odyssey block"),
 ("Judgment","JUD","Booster","$450",True,"End of Odyssey block"),
 ("Onslaught","ONS","Booster","$600",True,"Fetchlands debut"),
 ("Legions","LGN","Booster","$500",True,"All-creature set"),
 ("Scourge","SCG","Booster","$550",True,"End of Onslaught block"),
]),
("Mirrodin to Future Sight — 2003–2007", [
 ("Eighth Edition","8ED","Booster","$500",True,"Modern-frame core set"),
 ("Mirrodin","MRD","Booster","$700",True,"Affinity artifacts"),
 ("Darksteel","DST","Booster","$450",True,"Mirrodin block"),
 ("Fifth Dawn","5DN","Booster","$450",True,"End of Mirrodin block"),
 ("Champions of Kamigawa","CHK","Booster","$500",True,"Kamigawa block opener"),
 ("Unhinged","UNH","Booster","$800",True,"Silver-border un-set"),
 ("Betrayers of Kamigawa","BOK","Booster","$350",True,"Kamigawa block"),
 ("Saviors of Kamigawa","SOK","Booster","$400",True,"End of Kamigawa block"),
 ("Ninth Edition","9ED","Booster","$400",True,"Core set"),
 ("Ravnica: City of Guilds","RAV","Booster","$700",True,"Shocklands debut"),
 ("Guildpact","GPT","Booster","$400",True,"Ravnica block"),
 ("Dissension","DIS","Booster","$400",True,"End of Ravnica block"),
 ("Coldsnap","CSP","Booster","$500",True,"Ice Age throwback"),
 ("Time Spiral","TSP","Booster","$600",True,"Timeshifted cards"),
 ("Planar Chaos","PLC","Booster","$400",True,"Time Spiral block"),
 ("Future Sight","FUT","Booster","$500",True,"Futureshifted cards"),
]),
("Lorwyn to New Phyrexia — 2007–2011", [
 ("Tenth Edition","10E","Booster","$350",True,"Core set"),
 ("Lorwyn","LRW","Booster","$700",True,"Tribal block; beloved"),
 ("Morningtide","MOR","Booster","$400",True,"Lorwyn block"),
 ("Shadowmoor","SHM","Booster","$400",True,"Hybrid-mana block"),
 ("Eventide","EVE","Booster","$350",True,"End of Shadowmoor block"),
 ("Shards of Alara","ALA","Booster","$400",True,"Shards block opener"),
 ("Conflux","CON","Booster","$300",True,"Alara block"),
 ("Alara Reborn","ARB","Booster","$300",True,"All-multicolor set"),
 ("Magic 2010","M10","Booster","$300",True,"Modern core-set reboot"),
 ("Zendikar","ZEN","Booster","$1,000",True,"OG fetchlands; very popular"),
 ("Worldwake","WWK","Booster","$450",True,"Jace, the Mind Sculptor"),
 ("Rise of the Eldrazi","ROE","Booster","$400",True,"Eldrazi debut"),
 ("Magic 2011","M11","Booster","$250",True,"Core set"),
 ("Scars of Mirrodin","SOM","Booster","$350",True,"Return to Mirrodin"),
 ("Mirrodin Besieged","MBS","Booster","$250",True,"Scars block"),
 ("New Phyrexia","NPH","Booster","$350",True,"Phyrexian mana"),
]),
("Innistrad to Origins — 2011–2015", [
 ("Magic 2012","M12","Booster","$250",True,"Core set"),
 ("Innistrad","ISD","Booster","$650",True,"Beloved gothic set"),
 ("Dark Ascension","DKA","Booster","$300",True,"Innistrad block"),
 ("Avacyn Restored","AVR","Booster","$250",True,"End of Innistrad block"),
 ("Magic 2013","M13","Booster","$200",True,"Core set"),
 ("Return to Ravnica","RTR","Booster","$300",True,"Shocklands return"),
 ("Gatecrash","GTC","Booster","$250",True,"Ravnica block"),
 ("Dragon's Maze","DGM","Booster","$250",True,"End of RTR block"),
 ("Modern Masters","MMA","Booster","$600",True,"First Modern reprint set"),
 ("Magic 2014","M14","Booster","$220",True,"Core set"),
 ("Theros","THS","Booster","$250",True,"Greek-myth block"),
 ("Born of the Gods","BNG","Booster","$200",True,"Theros block"),
 ("Journey into Nyx","JOU","Booster","$200",True,"End of Theros block"),
 ("Conspiracy","CNS","Booster","$250",True,"Multiplayer draft set"),
 ("Magic 2015","M15","Booster","$200",True,"Core set"),
 ("Khans of Tarkir","KTK","Booster","$280",True,"Onslaught fetchlands"),
 ("Fate Reforged","FRF","Booster","$200",True,"Tarkir block"),
 ("Modern Masters 2015","MM2","Booster","$300",True,"Modern reprints"),
 ("Dragons of Tarkir","DTK","Booster","$200",True,"End of Tarkir block"),
 ("Magic Origins","ORI","Booster","$250",True,"Last classic core set"),
]),
("BFZ to Core 2020 — 2015–2019", [
 ("Battle for Zendikar","BFZ","Booster","$150",True,"Expeditions lands"),
 ("Oath of the Gatewatch","OGW","Booster","$150",True,"BFZ block"),
 ("Shadows over Innistrad","SOI","Booster","$160",True,"Return to Innistrad"),
 ("Eldritch Moon","EMN","Booster","$160",True,"End of SOI block"),
 ("Eternal Masters","EMA","Booster","$320",True,"Eternal reprints"),
 ("Conspiracy: Take the Crown","CN2","Booster","$200",True,"Multiplayer draft set"),
 ("Kaladesh","KLD","Booster","$160",True,"Masterpieces"),
 ("Aether Revolt","AER","Booster","$150",True,"Kaladesh block"),
 ("Modern Masters 2017","MM3","Booster","$260",True,"Modern reprints"),
 ("Amonkhet","AKH","Booster","$130",True,"Egyptian block"),
 ("Hour of Devastation","HOU","Booster","$130",True,"Amonkhet block"),
 ("Iconic Masters","IMA","Booster","$200",True,"Reprint set"),
 ("Unstable","UST","Booster","$200",True,"Silver-border un-set"),
 ("Ixalan","XLN","Booster","$140",True,"Pirates & dinosaurs"),
 ("Rivals of Ixalan","RIX","Booster","$130",True,"Ixalan block"),
 ("Masters 25","A25","Booster","$320",True,"25th-anniversary reprints"),
 ("Dominaria","DOM","Booster","$160",True,"Return to Dominaria"),
 ("Core Set 2019","M19","Booster","$130",True,"Core set"),
 ("Battlebond","BBD","Booster","$220",True,"Two-headed draft set"),
 ("Guilds of Ravnica","GRN","Booster","$150",True,"Ravnica returns"),
 ("Ultimate Masters","UMA","Booster","$500",True,"Box Toppers; premium reprints"),
 ("Ravnica Allegiance","RNA","Booster","$150",True,"GRN block"),
 ("War of the Spark","WAR","Booster","$180",True,"Planeswalker set"),
 ("Modern Horizons","MH1","Booster","$350",True,"Straight-to-Modern set"),
 ("Core Set 2020","M20","Booster","$130",True,"Core set"),
]),
("Draft & Set Booster Era — 2019–2023", [
 ("Throne of Eldraine","ELD","Draft","$200",True,"No Set Booster (pre-ZNR)"),
 ("Theros Beyond Death","THB","Draft","$150",True,"No Set Booster (pre-ZNR)"),
 ("Ikoria: Lair of Behemoths","IKO","Draft","$140",True,"No Set Booster (pre-ZNR)"),
 ("Core Set 2021","M21","Draft","$120",True,"No Set Booster (pre-ZNR)"),
 ("Double Masters","2XM","Draft","$300",True,"Reprint; Draft only"),
 ("Zendikar Rising","ZNR","Set","$150",True,"Set Booster debuts"),
 ("Commander Legends","CMR","Draft","$200",True,"Draftable Cmdr; Draft only"),
 ("Kaldheim","KHM","Set","$150",True,"Norse-myth set"),
 ("Time Spiral Remastered","TSR","Draft","$300",True,"Reprint; Draft only"),
 ("Strixhaven: School of Mages","STX","Set","$150",True,"Mystical Archive"),
 ("Modern Horizons 2","MH2","Set","$320",True,"High-demand Modern set"),
 ("Adventures in the Forgotten Realms","AFR","Set","$130",True,"D&D crossover"),
 ("Innistrad: Midnight Hunt","MID","Set","$130",True,"Innistrad returns"),
 ("Innistrad: Crimson Vow","VOW","Set","$130",True,"Vampire wedding"),
 ("Innistrad: Double Feature","DBL","Draft","$220",True,"All-foil MID+VOW reprint"),
 ("Kamigawa: Neon Dynasty","NEO","Set","$150",True,"Cyberpunk Kamigawa"),
 ("Streets of New Capenna","SNC","Set","$130",True,"Crime families"),
 ("Commander Legends: Baldur's Gate","CLB","Set","$320",True,"18-pack Set display; foil-etched legend"),
 ("Double Masters 2022","2X2","Draft","$240",True,"Reprint; Draft only"),
 ("Dominaria United","DMU","Set","$130",True,"Brothers' War prelude"),
 ("Unfinity","UNF","Draft","$150",True,"Un-set; Draft only"),
 ("The Brothers' War","BRO","Set","$130",True,"Artifact war set"),
 ("Dominaria Remastered","DMR","Draft","$200",True,"Reprint; Draft only"),
 ("Phyrexia: All Will Be One","ONE","Set","$130",True,"Phyrexian invasion"),
 ("March of the Machine","MOM","Set","$120",True,"Multiversal war"),
 ("March of the Machine: Aftermath","MAT","Epilogue","$90",True,"24-pack Epilogue display; not draftable"),
 ("LotR: Tales of Middle-earth","LTR","Set","$260",True,"Best-seller; UB"),
 ("Commander Masters","CMM","Set","$600",True,"24-pack Set display; borderless card every pack"),
 ("Wilds of Eldraine","WOE","Set","$120",True,"Fairy-tale return"),
 ("The Lost Caverns of Ixalan","LCI","Set","$120",True,"Last Set Booster set"),
]),
("Play Booster Era — 2024–2026", [
 ("Ravnica Remastered","RVR","Draft","$180",True,"Last draft-era reprint"),
 ("Murders at Karlov Manor","MKM","Play","$120",True,"First Play Booster set"),
 ("Outlaws of Thunder Junction","OTJ","Play","$120",True,"Western heist set"),
 ("Modern Horizons 3","MH3","Play","$250",True,"High-demand Modern set"),
 ("Assassin's Creed","ACR","Beyond","$130",True,"UB Beyond booster"),
 ("Bloomburrow","BLB","Play","$130",True,"Woodland critters"),
 ("Duskmourn: House of Horror","DSK","Play","$120",True,"Modern-horror set"),
 ("Magic: The Gathering Foundations","FDN","Play","$130",True,"Evergreen core set"),
 ("Innistrad Remastered","INR","Play","$150",True,"Innistrad reprints"),
 ("Aetherdrift","DFT","Play","$110",True,"Racing set"),
 ("Tarkir: Dragonstorm","TDM","Play","$120",True,"Return to Tarkir"),
 ("Final Fantasy","FIN","Play","$250",True,"Best-selling set ever; UB"),
 ("Edge of Eternities","EOE","Play","$120",True,"Sci-fi space set"),
 ("Marvel's Spider-Man","SPM","Play","$130",True,"UB expansion"),
 ("Avatar: The Last Airbender","ATL","Play","$120",True,"UB expansion"),
 ("Lorwyn Eclipsed","ECL","Play","$120",True,"Return to Lorwyn"),
 ("Teenage Mutant Ninja Turtles","TMT","Play","$130",True,"UB expansion"),
 ("Secrets of Strixhaven","SOS","Play","$120",True,"Mystical Archive returns"),
 ("Marvel Super Heroes","MSH","Play","$130",True,"UB; releases late Jun 2026"),
]),
("Jumpstart Boxes — 2020–2026  (separate card pool)", [
 ("Jumpstart","JMP","Jumpstart","$120",True,"2020 • Jumpstart-exclusive cards"),
 ("Jumpstart 2022","J22","Jumpstart","$100",True,"2022 • own exclusives"),
 ("Foundations Jumpstart","J25","Jumpstart","$110",True,"2024 • 51 anime-art exclusives"),
 ("Avatar: The Last Airbender Jumpstart","ATLJ","Jumpstart","$120",True,"2025 • UB-attached"),
 ("Marvel Super Heroes Jumpstart","MSHJ","Jumpstart","$120",True,"2026 • UB-attached"),
]),
("Mystery Booster Displays — 2019–2024  (event / limited distribution)", [
 ("Mystery Booster — Convention Ed.","MB1","Mystery","$345",True,"2019 MagicFest original • playtest slot • 24 packs"),
 ("Mystery Booster — Retail Ed.","MB1","Mystery","$355",True,"2020 WPN retail • foil slot • 24 packs"),
 ("Mystery Booster — Convention Ed. (2021)","MB1","Mystery","$310",True,"WPN reprint • revised playtest pool • 24 packs"),
 ("Mystery Booster 2","MB2","Mystery","$295",True,"2024 Festival in a Box / MagicCon • 24 packs"),
]),
("Upcoming — Late 2026  (not yet released)", [
 ("The Hobbit","TBA","Play","TBA",False,"Aug 2026 • UB"),
 ("Reality Fracture","TBA","Play","TBA",False,"Oct 2026 • Jace 'What If?' set"),
 ("Star Trek","TBA","Play","TBA",False,"Nov 2026 • UB"),
]),
]

NSETS = sum(len(rows) for _, rows in ERAS)

# Every non-Collector booster-display type sold for an existing checklist row.
# The row tuple above remains the collecting goal (and the printable PDF's one
# checkbox); this matrix lets the web dashboard add real optional inventory
# without changing completion. Required type is deliberately first so the
# original positional migration and the v2 ``Box`` key remain stable.
BOX_PRODUCTS = {
    # Theme Boosters premiered with Guilds of Ravnica and ran through SNC.
    "Guilds of Ravnica": ("Booster", "Theme"),
    "Ravnica Allegiance": ("Booster", "Theme"),
    "War of the Spark": ("Booster", "Theme"),
    "Core Set 2020": ("Booster", "Theme"),
    "Throne of Eldraine": ("Draft", "Theme"),
    "Theros Beyond Death": ("Draft", "Theme"),
    "Ikoria: Lair of Behemoths": ("Draft", "Theme"),
    "Core Set 2021": ("Draft", "Theme"),
    "Zendikar Rising": ("Set", "Draft", "Theme"),
    "Kaldheim": ("Set", "Draft", "Theme"),
    "Strixhaven: School of Mages": ("Set", "Draft", "Theme"),
    "Adventures in the Forgotten Realms": ("Set", "Draft", "Theme"),
    "Innistrad: Midnight Hunt": ("Set", "Draft", "Theme"),
    "Innistrad: Crimson Vow": ("Set", "Draft", "Theme"),
    "Kamigawa: Neon Dynasty": ("Set", "Draft", "Theme"),
    "Streets of New Capenna": ("Set", "Draft", "Theme"),

    # Sets with both Draft and Set Booster displays.
    "Modern Horizons 2": ("Set", "Draft"),
    "Commander Legends: Baldur's Gate": ("Set", "Draft"),
    "Dominaria United": ("Set", "Draft", "Jumpstart"),
    "The Brothers' War": ("Set", "Draft", "Jumpstart"),
    "Phyrexia: All Will Be One": ("Set", "Draft", "Jumpstart"),
    "March of the Machine": ("Set", "Draft", "Jumpstart"),
    "LotR: Tales of Middle-earth": ("Set", "Draft", "Jumpstart", "JS Vol. 2"),
    "Commander Masters": ("Set", "Draft"),
    "Wilds of Eldraine": ("Set", "Draft"),
    "The Lost Caverns of Ixalan": ("Set", "Draft"),
}

PAGE_W, PAGE_H = landscape(letter)
LM=RM=24; TM=22; BM=18; GUT=14; H1=86
COLW = (PAGE_W - LM - RM - GUT)/2.0
TBLW = COLW
cols = [13, 112, 32, 40, 44, TBLW-241]  # chk,set,code,boxtype,value,note

def make_frames(top_y):
    h = top_y - BM
    fL = Frame(LM, BM, COLW, h, leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
    fR = Frame(LM+COLW+GUT, BM, COLW, h, leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
    return [fL, fR]

def draw_header(canvas, doc):
    canvas.saveState()
    cx = PAGE_W/2.0
    y = PAGE_H - TM - 11
    canvas.setFillColor(PURPLE); canvas.setFont("Helvetica-Bold", 15)
    canvas.drawCentredString(cx, y, "Magic: The Gathering  —  Booster Display Checklist  (1993–2026)")
    canvas.setFillColor(GREY); canvas.setFont("Helvetica", 7.5)
    canvas.drawCentredString(cx, y-12, "One non-Collector randomized display per set or distinct edition — including Set, Epilogue, Jumpstart, and Mystery  •  values approx., July 2026")
    sy = y-30
    stats = [(str(NSETS),"BOXES / DISPLAYS"),("1993–2026","RELEASE SPAN"),("$90 → $250k+","VALUE RANGE")]
    sx = [cx-175, cx, cx+175]
    for (num,lbl),x in zip(stats,sx):
        canvas.setFillColor(LPURPLE); canvas.setFont("Helvetica-Bold",12.5)
        canvas.drawCentredString(x, sy, num)
        canvas.setFillColor(GREY); canvas.setFont("Helvetica",6)
        canvas.drawCentredString(x, sy-9, lbl)
    ly = sy-22
    canvas.setFont("Helvetica",6.4)
    items=[("Booster",B_BOOST),("Draft",B_DRAFT),("Set",B_SET),("Play",B_PLAY),("Beyond",B_BEY),
           ("Jumpstart",B_JUMP),("Epilogue/Mystery",B_SPECIAL)]
    seg_w=[8+canvas.stringWidth(t,"Helvetica",6.4)+12 for t,_ in items]
    extra="  •  amber = estimate; bold-dark = recent PriceCharting anchor; vintage values are thin/volatile — verify before buying."
    total=sum(seg_w)+canvas.stringWidth(extra,"Helvetica",6.4)
    x=cx-total/2.0
    for (t,col),w in zip(items,seg_w):
        canvas.setFillColor(col); canvas.rect(x,ly-1,6,6,stroke=0,fill=1)
        canvas.setFillColor(GREY); canvas.drawString(x+9,ly,t); x+=w
    canvas.setFillColor(GREY); canvas.drawString(x,ly,extra)
    canvas.setStrokeColor(PURPLE); canvas.setLineWidth(1.5)
    canvas.line(LM, PAGE_H-TM-H1+6, PAGE_W-RM, PAGE_H-TM-H1+6)
    canvas.restoreState()

def era_block(era_name, rows):
    eh = Table([[Paragraph(era_name, era_st)]], colWidths=[TBLW])
    eh.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),PURPLE),
                            ("TOPPADDING",(0,0),(-1,-1),3),("BOTTOMPADDING",(0,0),(-1,-1),3),
                            ("LEFTPADDING",(0,0),(-1,-1),6)]))
    head=[Paragraph("",hdr_cell),Paragraph("SET",hdr_cell),Paragraph("CODE",hdr_cell),
          Paragraph("BOX",hdr_cell),Paragraph("VALUE",hdr_cell),Paragraph("NOTE",hdr_cell)]
    data=[head]
    for (s,code,typ,val,est,note) in rows:
        if val=="TBA":
            vstyle=val_tba; vtxt="TBA"
        elif val=="NA":
            vstyle=val_tba; vtxt="—"
        else:
            vstyle=val_est if est else val_st
            vtxt=("~"+val) if est else val
        data.append([Checkbox(),Paragraph(s,cell_b),Paragraph(code,cell_code),
                     tag_for(typ),Paragraph(vtxt,vstyle),Paragraph(note,cell_note)])
    t=Table(data,colWidths=cols,repeatRows=1)
    ts=[("BACKGROUND",(0,0),(-1,0),HEADBG),
        ("LINEBELOW",(0,0),(-1,0),1,colors.HexColor("#c9bfe8")),
        ("LINEBELOW",(0,1),(-1,-1),0.4,GRID),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
        ("ALIGN",(0,0),(0,-1),"CENTER"),("ALIGN",(3,0),(3,-1),"CENTER"),
        ("TOPPADDING",(0,0),(-1,-1),2.2),("BOTTOMPADDING",(0,0),(-1,-1),2.2),
        ("LEFTPADDING",(0,0),(-1,-1),4),("RIGHTPADDING",(0,0),(-1,-1),4)]
    for i in range(1,len(data)):
        if i%2==0: ts.append(("BACKGROUND",(0,i),(-1,i),ROWALT))
    t.setStyle(TableStyle(ts))
    return KeepTogether([eh, t, Spacer(1,5)])

doc = BaseDocTemplate("mtg_booster_box_checklist.pdf", pagesize=landscape(letter),
                      leftMargin=LM,rightMargin=RM,topMargin=TM,bottomMargin=BM,
                      title="MTG Booster Box Checklist")
first = PageTemplate(id="first", frames=make_frames(PAGE_H-TM-H1), onPage=draw_header)
later = PageTemplate(id="later", frames=make_frames(PAGE_H-TM))
doc.addPageTemplates([first, later])

story=[NextPageTemplate("later")]
for name,rows in ERAS:
    story.append(era_block(name,rows))

notes_html=("<b>Scope &amp; notes.</b> &bull; One non-Collector randomized booster display per set or materially distinct edition "
 "(classic <b>Booster</b> &rarr; <b>Draft</b> &rarr; <b>Set</b> &rarr; <b>Play</b>, plus <b>Beyond</b>, <b>Epilogue</b>, "
 "standalone <b>Jumpstart</b>, and <b>Mystery</b> displays). Where both Draft and Set displays existed, Set is tracked. "
 "Mystery editions remain separate because their collation and distribution differ. &bull; <b>Alpha/Beta/Unlimited</b> were only sticker-sealed, so genuinely sealed boxes "
 "essentially don't exist &mdash; treat as museum pieces. &bull; <b>Excluded</b> (no standard booster box): Commander precon sets and "
 "Collector-only UB sets <b>Doctor Who, Fallout, Warhammer 40K</b>; box sets (Game Night, Battle Royale, Beatdown, Anthologies, "
 "Unsanctioned); Duel Decks, Planechase/Archenemy; Starter 1999/2000; Secret Lair / From the Vault; "
 "and digital-only sets (MTGO Masters Editions, Vintage Masters, Pioneer Masters, Arena Remasters). &bull; <b>2027:</b> six more sets "
 "confirmed, unnamed. &bull; The web dashboard additionally tracks Draft, Theme, and set-attached Jumpstart displays as bonus inventory; "
 "they do not change this printable goal. &bull; Vintage sealed values are thin and volatile &mdash; confirm on PriceCharting, eBay sold listings &amp; "
 "Heritage Auctions before buying.")
nb=Table([[Paragraph(notes_html,note_box_st)]],colWidths=[TBLW])
nb.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),colors.HexColor("#f5f2fc")),
                        ("BOX",(0,0),(-1,-1),0.6,colors.HexColor("#d9cff0")),
                        ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5),
                        ("LEFTPADDING",(0,0),(-1,-1),7),("RIGHTPADDING",(0,0),(-1,-1),7)]))
story.append(KeepTogether([nb, Spacer(1,4),
    Paragraph("Compiled July 2026 &bull; %d sets &bull; approximate secondary-market values (PriceCharting, MTGStocks, TCGPlayer, " % NSETS +
              "Heritage Auctions). MTG is &copy; Wizards of the Coast. Unofficial fan reference.", foot_st)]))

doc.build(story)
print("built")
