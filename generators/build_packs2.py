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
DIM = colors.HexColor("#c2c2c2")
# booster-type accent colors (checkbox borders)
C_MAIN = colors.HexColor("#6a4fb0")
C_SET  = colors.HexColor("#b5852a")
C_COLL = colors.HexColor("#9c3d54")

styles = getSampleStyleSheet()
cell = ParagraphStyle("cell", parent=styles["Normal"], fontSize=7.0, leading=8.2)
cell_b = ParagraphStyle("cellb", parent=cell, fontName="Helvetica-Bold")
cell_code = ParagraphStyle("code", parent=cell, textColor=GREY, fontSize=6.6)
cell_note = ParagraphStyle("note", parent=cell, fontSize=6.3, textColor=colors.HexColor("#555555"), leading=7.6)
dash = ParagraphStyle("dash", parent=cell, alignment=1, textColor=DIM)
tot = ParagraphStyle("tot", parent=cell, fontName="Helvetica-Bold", alignment=1, textColor=LPURPLE, fontSize=7.2)
era_st = ParagraphStyle("era", parent=styles["Normal"], fontSize=9, textColor=colors.white, fontName="Helvetica-Bold", leading=10.5)
era_cnt = ParagraphStyle("erac", parent=era_st, alignment=2, fontSize=8)
hdr_cell = ParagraphStyle("hc", parent=styles["Normal"], fontSize=5.6, fontName="Helvetica-Bold", textColor=PURPLE, alignment=1)
hdr_l = ParagraphStyle("hl", parent=hdr_cell, alignment=0)
note_box_st = ParagraphStyle("nb", parent=styles["Normal"], fontSize=6.7, leading=9.4, textColor=colors.HexColor("#333333"))
foot_st = ParagraphStyle("foot", parent=styles["Normal"], fontSize=6, textColor=colors.HexColor("#888888"), leading=8)

class DoubleCheck(Flowable):
    """Two small checkboxes side by side (for '2 of this pack')."""
    def __init__(self, color, size=7.0, gap=3.0):
        super().__init__()
        self.color=color; self.size=size; self.gap=gap
        self.width=size*2+gap; self.height=size
    def draw(self):
        c=self.canv; c.setStrokeColor(self.color); c.setLineWidth(1)
        c.roundRect(0,0,self.size,self.size,1.2,stroke=1,fill=0)
        c.roundRect(self.size+self.gap,0,self.size,self.size,1.2,stroke=1,fill=0)

# (set, code, main, set_, coll, est, note)   -1 => type not offered
ERAS = [
("The Beginning — 1993–1995", [
 ("Limited Edition Alpha","LEA",1,-1,-1,False,"Sticker-sealed boxes only"),
 ("Limited Edition Beta","LEB",1,-1,-1,False,""),
 ("Unlimited Edition","2ED",1,-1,-1,False,""),
 ("Arabian Nights","ARN",1,-1,-1,False,"1st expansion"),
 ("Antiquities","ATQ",1,-1,-1,False,""),
 ("Revised Edition (3rd)","3ED",1,-1,-1,False,""),
 ("Legends","LEG",1,-1,-1,False,""),
 ("The Dark","DRK",1,-1,-1,False,""),
 ("Fallen Empires","FEM",1,-1,-1,False,""),
 ("Fourth Edition","4ED",1,-1,-1,False,""),
 ("Ice Age","ICE",1,-1,-1,False,""),
 ("Chronicles","CHR",1,-1,-1,False,"Reprint set"),
 ("Homelands","HML",1,-1,-1,False,""),
 ("Alliances","ALL",1,-1,-1,False,""),
]),
("Rath, Urza & Portal — 1996–1999", [
 ("Mirage","MIR",1,-1,-1,False,""),("Visions","VIS",1,-1,-1,False,""),
 ("Fifth Edition","5ED",1,-1,-1,False,""),("Weatherlight","WTH",1,-1,-1,False,""),
 ("Tempest","TMP",1,-1,-1,False,""),("Stronghold","STH",1,-1,-1,False,""),
 ("Exodus","EXO",1,-1,-1,False,""),("Portal","POR",1,-1,-1,False,""),
 ("Unglued","UGL",1,-1,-1,False,"Un-set"),("Urza's Saga","USG",1,-1,-1,False,""),
 ("Portal Second Age","PO2",1,-1,-1,False,""),("Urza's Legacy","ULG",1,-1,-1,False,""),
 ("Sixth Edition","6ED",1,-1,-1,False,""),("Urza's Destiny","UDS",1,-1,-1,False,""),
 ("Portal Three Kingdoms","PTK",1,-1,-1,False,""),("Mercadian Masques","MMQ",1,-1,-1,False,""),
]),
("Masques to Onslaught — 2000–2003", [
 ("Nemesis","NEM",1,-1,-1,False,""),("Prophecy","PCY",1,-1,-1,False,""),
 ("Invasion","INV",1,-1,-1,False,""),("Planeshift","PLS",1,-1,-1,False,""),
 ("Apocalypse","APC",1,-1,-1,False,""),("Seventh Edition","7ED",1,-1,-1,False,""),
 ("Odyssey","ODY",1,-1,-1,False,""),("Torment","TOR",1,-1,-1,False,""),
 ("Judgment","JUD",1,-1,-1,False,""),("Onslaught","ONS",1,-1,-1,False,""),
 ("Legions","LGN",1,-1,-1,False,""),("Scourge","SCG",1,-1,-1,False,""),
]),
("Mirrodin to Future Sight — 2003–2007", [
 ("Eighth Edition","8ED",1,-1,-1,False,""),("Mirrodin","MRD",1,-1,-1,False,""),
 ("Darksteel","DST",1,-1,-1,False,""),("Fifth Dawn","5DN",1,-1,-1,False,""),
 ("Champions of Kamigawa","CHK",1,-1,-1,False,""),("Betrayers of Kamigawa","BOK",1,-1,-1,False,""),
 ("Saviors of Kamigawa","SOK",1,-1,-1,False,""),("Ninth Edition","9ED",1,-1,-1,False,""),
 ("Ravnica: City of Guilds","RAV",1,-1,-1,False,""),("Guildpact","GPT",1,-1,-1,False,""),
 ("Dissension","DIS",1,-1,-1,False,""),("Coldsnap","CSP",1,-1,-1,False,""),
 ("Time Spiral","TSP",1,-1,-1,False,""),("Planar Chaos","PLC",1,-1,-1,False,""),
 ("Future Sight","FUT",1,-1,-1,False,""),
]),
("Lorwyn to New Phyrexia — 2007–2011", [
 ("Tenth Edition","10E",1,-1,-1,False,""),("Lorwyn","LRW",1,-1,-1,False,""),
 ("Morningtide","MOR",1,-1,-1,False,""),("Shadowmoor","SHM",1,-1,-1,False,""),
 ("Eventide","EVE",1,-1,-1,False,""),("Shards of Alara","ALA",1,-1,-1,False,""),
 ("Conflux","CON",1,-1,-1,False,""),("Alara Reborn","ARB",1,-1,-1,False,""),
 ("Magic 2010","M10",1,-1,-1,False,""),("Zendikar","ZEN",1,-1,-1,False,""),
 ("Worldwake","WWK",1,-1,-1,False,""),("Rise of the Eldrazi","ROE",1,-1,-1,False,""),
 ("Magic 2011","M11",1,-1,-1,False,""),("Scars of Mirrodin","SOM",1,-1,-1,False,""),
 ("Mirrodin Besieged","MBS",1,-1,-1,False,""),("New Phyrexia","NPH",1,-1,-1,False,""),
]),
("Innistrad to Origins — 2011–2015", [
 ("Magic 2012","M12",1,-1,-1,False,""),("Innistrad","ISD",1,-1,-1,False,""),
 ("Dark Ascension","DKA",1,-1,-1,False,""),("Avacyn Restored","AVR",1,-1,-1,False,""),
 ("Magic 2013","M13",1,-1,-1,False,""),("Return to Ravnica","RTR",1,-1,-1,False,""),
 ("Gatecrash","GTC",1,-1,-1,False,""),("Dragon's Maze","DGM",1,-1,-1,False,""),
 ("Modern Masters","MMA",1,-1,-1,False,""),("Magic 2014","M14",1,-1,-1,False,""),
 ("Theros","THS",1,-1,-1,False,""),("Born of the Gods","BNG",1,-1,-1,False,""),
 ("Journey into Nyx","JOU",1,-1,-1,False,""),("Conspiracy","CNS",1,-1,-1,False,""),
 ("Magic 2015","M15",1,-1,-1,False,""),("Khans of Tarkir","KTK",1,-1,-1,False,""),
 ("Fate Reforged","FRF",1,-1,-1,False,""),("Modern Masters 2015","MM2",1,-1,-1,False,""),
 ("Dragons of Tarkir","DTK",1,-1,-1,False,""),("Magic Origins","ORI",1,-1,-1,False,""),
]),
("BFZ to Core 2020 — 2015–2019", [
 ("Battle for Zendikar","BFZ",1,-1,-1,False,""),("Oath of the Gatewatch","OGW",1,-1,-1,False,""),
 ("Shadows over Innistrad","SOI",1,-1,-1,False,""),("Eldritch Moon","EMN",1,-1,-1,False,""),
 ("Eternal Masters","EMA",1,-1,-1,False,""),("Conspiracy: Take the Crown","CN2",1,-1,-1,False,""),
 ("Kaladesh","KLD",1,-1,-1,False,""),("Aether Revolt","AER",1,-1,-1,False,""),
 ("Modern Masters 2017","MM3",1,-1,-1,False,""),("Amonkhet","AKH",1,-1,-1,False,""),
 ("Hour of Devastation","HOU",1,-1,-1,False,""),("Iconic Masters","IMA",1,-1,-1,False,""),
 ("Ixalan","XLN",1,-1,-1,False,""),("Rivals of Ixalan","RIX",1,-1,-1,False,""),
 ("Masters 25","A25",1,-1,-1,False,""),("Dominaria","DOM",1,-1,-1,False,""),
 ("Core Set 2019","M19",1,-1,-1,False,""),("Battlebond","BBD",1,-1,-1,False,""),
 ("Guilds of Ravnica","GRN",1,-1,-1,False,""),
 ("Ravnica Allegiance","RNA",1,-1,1,False,"+ experimental Collector"),
 ("War of the Spark","WAR",1,-1,-1,False,""),("Modern Horizons","MH1",1,-1,-1,False,""),
 ("Core Set 2020","M20",1,-1,-1,False,""),
]),
("Draft + Set + Collector Era — 2019–2023", [
 ("Throne of Eldraine","ELD",1,-1,1,False,"Collector debuts"),
 ("Theros Beyond Death","THB",1,-1,1,False,""),
 ("Ikoria: Lair of Behemoths","IKO",1,-1,1,False,""),
 ("Core Set 2021","M21",1,-1,1,False,""),
 ("Double Masters","2XM",1,-1,-1,False,"VIP pack: see one-offs"),
 ("Zendikar Rising","ZNR",1,1,1,False,"Set Booster debuts"),
 ("Commander Legends","CMR",1,-1,1,False,"Draftable Cmdr set"),
 ("Kaldheim","KHM",1,1,1,False,""),
 ("Time Spiral Remastered","TSR",1,-1,-1,False,"Draft only"),
 ("Strixhaven: School of Mages","STX",1,1,1,False,""),
 ("Modern Horizons 2","MH2",1,1,1,False,""),
 ("Adventures in the Forgotten Realms","AFR",1,1,1,False,""),
 ("Innistrad: Midnight Hunt","MID",1,1,1,False,""),
 ("Innistrad: Crimson Vow","VOW",1,1,1,False,""),
 ("Innistrad: Double Feature","DBL",1,-1,-1,False,"All-foil draft set"),
 ("Kamigawa: Neon Dynasty","NEO",1,1,1,False,""),
 ("Streets of New Capenna","SNC",1,1,1,False,""),
 ("Commander Legends: Baldur's Gate","CLB",1,1,1,False,"Draft, Set & Collector"),
 ("Double Masters 2022","2X2",1,-1,1,False,""),
 ("Dominaria United","DMU",1,1,1,False,""),
 ("Unfinity","UNF",1,-1,1,False,"Un-set"),
 ("The Brothers' War","BRO",1,1,1,False,""),
 ("Dominaria Remastered","DMR",1,-1,1,False,""),
 ("Phyrexia: All Will Be One","ONE",1,1,1,False,""),
 ("March of the Machine","MOM",1,1,1,False,""),
 ("March of the Machine: Aftermath","MAT",1,-1,1,False,"Epilogue mini-set"),
 ("LotR: Tales of Middle-earth","LTR",1,1,1,False,"UB; +Special Ed (one-offs)"),
 ("Commander Masters","CMM",1,1,1,False,"Draft, Set & Collector"),
 ("Wilds of Eldraine","WOE",1,1,1,False,""),
 ("Doctor Who","WHO",-1,-1,1,False,"Collector only (UB)"),
 ("The Lost Caverns of Ixalan","LCI",1,1,1,False,"Last Set Booster set"),
]),
("Play + Collector Era — 2024–2026", [
 ("Ravnica Remastered","RVR",1,-1,1,False,""),
 ("Murders at Karlov Manor","MKM",1,-1,1,False,"Play Booster debuts"),
 ("Fallout","PIP",-1,-1,1,False,"Collector only (UB)"),
 ("Outlaws of Thunder Junction","OTJ",1,-1,1,False,""),
 ("Modern Horizons 3","MH3",1,-1,1,False,""),
 ("Assassin's Creed","ACR",1,-1,1,False,"UB Beyond booster"),
 ("Bloomburrow","BLB",1,-1,1,False,""),
 ("Duskmourn: House of Horror","DSK",1,-1,1,False,""),
 ("Magic: The Gathering Foundations","FDN",1,-1,1,False,""),
 ("Innistrad Remastered","INR",1,-1,1,False,""),
 ("Aetherdrift","DFT",1,-1,1,False,""),
 ("Tarkir: Dragonstorm","TDM",1,-1,1,False,""),
 ("Final Fantasy","FIN",1,-1,1,False,"Best-seller; UB"),
 ("Edge of Eternities","EOE",1,-1,1,False,""),
 ("Marvel's Spider-Man","SPM",1,-1,1,False,"UB"),
 ("Avatar: The Last Airbender","ATL",1,-1,1,False,"UB"),
 ("Lorwyn Eclipsed","ECL",1,-1,1,False,""),
 ("Teenage Mutant Ninja Turtles","TMT",1,-1,1,False,"UB"),
 ("Secrets of Strixhaven","SOS",1,-1,1,False,""),
 ("Marvel Super Heroes","MSH",1,-1,1,False,"UB; late Jun 2026"),
]),
("Upcoming — Late 2026  (projected)", [
 ("The Hobbit","TBA",1,-1,1,True,"Aug 2026 • UB"),
 ("Reality Fracture","TBA",1,-1,1,True,"Oct 2026"),
 ("Star Trek","TBA",1,-1,1,True,"Nov 2026 • UB"),
]),
("Mystery Booster & Special-Edition Packs (one-offs)", [
 ("Mystery Booster — Convention Ed.","MB1",1,-1,-1,False,"2019 • random reprints"),
 ("Mystery Booster — Retail Ed.","MB1",1,-1,-1,False,"2020 • foil slot"),
 ("Mystery Booster — Convention Ed. (2021)","MB1",1,-1,-1,False,"WPN reprint • revised playtest pool"),
 ("Mystery Booster 2","MB2",1,-1,-1,False,"2024 • random reprints"),
 ("Double Masters VIP Edition","2XM",-1,-1,1,False,"2020 • premium foil pack"),
 ("LotR: Middle-earth — Special Ed.","LTR",-1,-1,1,False,"2023 • all-foil Collector"),
]),
]

PAGE_W, PAGE_H = landscape(letter)
LM=RM=24; TM=22; BM=18; GUT=14; H1=92
COLW = (PAGE_W - LM - RM - GUT)/2.0
TBLW = COLW
# set, code, DRAFT/PLAY, SET, COLL, total, note
cols = [116, 30, 32, 30, 32, 24, TBLW-264]

def make_frames(top_y):
    h = top_y - BM
    fL = Frame(LM, BM, COLW, h, leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
    fR = Frame(LM+COLW+GUT, BM, COLW, h, leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
    return [fL, fR]

def packs_of(m,s,c):
    return 2*sum(1 for v in (m,s,c) if v>0)
GRAND = sum(packs_of(r[2],r[3],r[4]) for _,rows in ERAS for r in rows)
NCHK = GRAND  # one checkbox per pack

def draw_header(canvas, doc):
    canvas.saveState()
    cx = PAGE_W/2.0
    y = PAGE_H - TM - 11
    canvas.setFillColor(PURPLE); canvas.setFont("Helvetica-Bold", 15)
    canvas.drawCentredString(cx, y, "Magic: The Gathering  —  Booster-Pack Checklist  (2 of every pack)")
    canvas.setFillColor(GREY); canvas.setFont("Helvetica", 7.3)
    canvas.drawCentredString(cx, y-12, "Two of every booster pack per set, by type — Draft/Play, Set, Collector.  Tick a box as you get each pack.  Extra wrapper-art variants are a bonus.")
    sy = y-30
    stats = [(str(GRAND), "PACKS TO COLLECT"),("~175","SETS / PRODUCTS"),("1993–2026","SPAN")]
    sx = [cx-175, cx, cx+175]
    for (n,lbl),x in zip(stats,sx):
        canvas.setFillColor(LPURPLE); canvas.setFont("Helvetica-Bold",12.5)
        canvas.drawCentredString(x, sy, n)
        canvas.setFillColor(GREY); canvas.setFont("Helvetica",6)
        canvas.drawCentredString(x, sy-9, lbl)
    ly = sy-21
    canvas.setFont("Helvetica",6.5)
    items=[("Draft / Play pack",C_MAIN),("Set Booster",C_SET),("Collector Booster",C_COLL)]
    seg=[8+canvas.stringWidth(t,"Helvetica",6.5)+14 for t,_ in items]
    extra="  •  two boxes per type = buy 2 of that pack.  Set Boosters existed ~2020–2023; Collector from 2019 on."
    total=sum(seg)+canvas.stringWidth(extra,"Helvetica",6.5)
    x=cx-total/2.0
    for (t,col),w in zip(items,seg):
        canvas.setStrokeColor(col); canvas.setLineWidth(1); canvas.roundRect(x,ly-1,6,6,1.2,stroke=1,fill=0)
        canvas.setFillColor(GREY); canvas.drawString(x+9,ly,t); x+=w
    canvas.setFillColor(GREY); canvas.drawString(x,ly,extra)
    canvas.setStrokeColor(PURPLE); canvas.setLineWidth(1.5)
    canvas.line(LM, PAGE_H-TM-H1+6, PAGE_W-RM, PAGE_H-TM-H1+6)
    canvas.restoreState()

def typecell(v, color):
    if v<0: return Paragraph("—", dash)
    return DoubleCheck(color)

def era_block(era_name, rows):
    sub = sum(packs_of(r[2],r[3],r[4]) for r in rows)
    eh = Table([[Paragraph(era_name, era_st), Paragraph("%d packs"%sub, era_cnt)]],
               colWidths=[TBLW*0.74, TBLW*0.26])
    eh.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),PURPLE),
                            ("TOPPADDING",(0,0),(-1,-1),3),("BOTTOMPADDING",(0,0),(-1,-1),3),
                            ("LEFTPADDING",(0,0),(0,0),6),("RIGHTPADDING",(1,0),(1,0),6),
                            ("VALIGN",(0,0),(-1,-1),"MIDDLE")]))
    head=[Paragraph("SET",hdr_l),Paragraph("CODE",hdr_l),
          Paragraph("DRAFT/PLAY",hdr_cell),Paragraph("SET",hdr_cell),Paragraph("COLL",hdr_cell),
          Paragraph("#",hdr_cell),Paragraph("NOTE",hdr_l)]
    data=[head]
    for (s,code,m,st,c,est,note) in rows:
        p = packs_of(m,st,c)
        data.append([Paragraph(s,cell_b),Paragraph(code,cell_code),
                     typecell(m,C_MAIN),typecell(st,C_SET),typecell(c,C_COLL),
                     Paragraph(str(p),tot),Paragraph(note,cell_note)])
    t=Table(data,colWidths=cols,repeatRows=1)
    ts=[("BACKGROUND",(0,0),(-1,0),HEADBG),
        ("LINEBELOW",(0,0),(-1,0),1,colors.HexColor("#c9bfe8")),
        ("LINEBELOW",(0,1),(-1,-1),0.4,GRID),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
        ("ALIGN",(2,0),(5,-1),"CENTER"),
        ("TOPPADDING",(0,0),(-1,-1),2.3),("BOTTOMPADDING",(0,0),(-1,-1),2.3),
        ("LEFTPADDING",(0,0),(-1,-1),4),("RIGHTPADDING",(0,0),(-1,-1),4)]
    for i in range(1,len(data)):
        if i%2==0: ts.append(("BACKGROUND",(0,i),(-1,i),ROWALT))
    t.setStyle(TableStyle(ts))
    return KeepTogether([eh, t, Spacer(1,4)])

doc = BaseDocTemplate("mtg_booster_pack_checklist.pdf", pagesize=landscape(letter),
                      leftMargin=LM,rightMargin=RM,topMargin=TM,bottomMargin=BM,
                      title="MTG Booster-Pack Checklist (2 of every pack)")
first = PageTemplate(id="first", frames=make_frames(PAGE_H-TM-H1), onPage=draw_header)
later = PageTemplate(id="later", frames=make_frames(PAGE_H-TM))
doc.addPageTemplates([first, later])

story=[NextPageTemplate("later")]
for name,rows in ERAS:
    story.append(era_block(name,rows))

notes_html=("<b>How to use this.</b> Each set lists the booster <i>types</i> it was sold in; each type has <b>two checkboxes</b> &mdash; "
 "tick one per pack as you acquire your two copies. The <b>#</b> column is that set's pack total. Wrapper-art variants are ignored "
 "here &mdash; any art counts; getting extra arts is a bonus. &bull; <b>Types:</b> DRAFT/PLAY = the set's main draftable pack "
 "(classic Booster &rarr; Draft &rarr; Play &rarr; UB Beyond); SET = Set Booster (only ~2020&ndash;2023, ended at Murders at Karlov "
 "Manor); COLL = Collector Booster (Throne of Eldraine 2019 on, plus the Ravnica Allegiance experimental run and Collector-only UB "
 "sets Doctor Who &amp; Fallout). &bull; <b>Excluded:</b> Theme Boosters, Jumpstart / Welcome / starter packs, prerelease packs, and "
 "non-random products (Secret Lair, From the Vault). &bull; <b>2027:</b> six more sets confirmed, unnamed.")
nb=Table([[Paragraph(notes_html,note_box_st)]],colWidths=[TBLW])
nb.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),colors.HexColor("#f5f2fc")),
                        ("BOX",(0,0),(-1,-1),0.6,colors.HexColor("#d9cff0")),
                        ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5),
                        ("LEFTPADDING",(0,0),(-1,-1),7),("RIGHTPADDING",(0,0),(-1,-1),7)]))
story.append(KeepTogether([nb, Spacer(1,4),
    Paragraph("Compiled June 2026 &bull; %d packs (2 per booster type) across ~175 sets/products &bull; MTG is &copy; Wizards of the "
              "Coast. Unofficial fan reference." % GRAND, foot_st)]))

doc.build(story)
print("built; total packs =", GRAND)
