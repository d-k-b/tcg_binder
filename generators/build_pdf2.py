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
T_STD = colors.HexColor("#4a7c59")
T_REP = colors.HexColor("#b5852a")
T_UB  = colors.HexColor("#9c3d54")
T_SPC = colors.HexColor("#5566aa")
GREY = colors.HexColor("#666666")
TYPECOLOR = {"Standard": T_STD, "Reprint": T_REP, "Univ. Beyond": T_UB, "Special": T_SPC}

styles = getSampleStyleSheet()
cell = ParagraphStyle("cell", parent=styles["Normal"], fontSize=7.3, leading=8.6)
cell_b = ParagraphStyle("cellb", parent=cell, fontName="Helvetica-Bold")
cell_code = ParagraphStyle("code", parent=cell, textColor=GREY, fontSize=7)
cell_note = ParagraphStyle("note", parent=cell, fontSize=6.6, textColor=colors.HexColor("#555555"), leading=8)
val_st = ParagraphStyle("val", parent=cell, fontName="Helvetica-Bold", alignment=2, fontSize=7.3)
val_est = ParagraphStyle("vale", parent=val_st, textColor=AMBER)
val_tba = ParagraphStyle("vtba", parent=val_st, textColor=colors.HexColor("#9a9a9a"), fontName="Helvetica-Oblique")
era_st = ParagraphStyle("era", parent=styles["Normal"], fontSize=9.5, textColor=colors.white, fontName="Helvetica-Bold", leading=11)
hdr_cell = ParagraphStyle("hc", parent=styles["Normal"], fontSize=6, fontName="Helvetica-Bold", textColor=PURPLE)
note_box_st = ParagraphStyle("nb", parent=styles["Normal"], fontSize=6.8, leading=9.5, textColor=colors.HexColor("#333333"))
foot_st = ParagraphStyle("foot", parent=styles["Normal"], fontSize=6, textColor=colors.HexColor("#888888"), leading=8)

class Checkbox(Flowable):
    def __init__(self, size=8):
        super().__init__(); self.size=size; self.width=size; self.height=size
    def draw(self):
        self.canv.setStrokeColor(LPURPLE); self.canv.setLineWidth(1)
        self.canv.roundRect(0,0,self.size,self.size,1.3,stroke=1,fill=0)

class Tag(Flowable):
    def __init__(self, text, color, w=50, h=10):
        super().__init__(); self.text=text; self.color=color; self.width=w; self.height=h
    def draw(self):
        c=self.canv; c.setFillColor(self.color)
        c.roundRect(0,0,self.width,self.height,4.5,stroke=0,fill=1)
        c.setFillColor(colors.white); c.setFont("Helvetica-Bold",5.5)
        c.drawCentredString(self.width/2.0,2.7,self.text)

def tag_for(t): return Tag(t, TYPECOLOR[t])

# (set, code, type, value, is_est, note)
ERAS = [
("Launch Era — 2019–2020", [
 ("Throne of Eldraine","ELD","Standard","$450",True,"First Collector Booster set"),
 ("Theros Beyond Death","THB","Standard","$330",True,"Foil-extended titans & gods"),
 ("Ikoria: Lair of Behemoths","IKO","Standard","$470",False,"Godzilla Series monster"),
 ("Core Set 2021","M21","Standard","$300",True,"Borderless planeswalkers"),
 ("Double Masters","2XM","Reprint","$430",True,"2 rares/pack; out of print"),
 ("Zendikar Rising","ZNR","Standard","$360",False,"Zendikar Expeditions"),
]),
("Second Wave — 2021", [
 ("Kaldheim","KHM","Standard","$360",False,"Viking & Phyrexian showcases"),
 ("Strixhaven: School of Mages","STX","Standard","$459",False,"Mystical Archive cards"),
 ("Modern Horizons 2","MH2","Reprint","$600",True,"Modern staples; high demand"),
 ("Adventures in the Forgotten Realms","AFR","Standard","$300",True,"D&D crossover lands"),
 ("Innistrad: Midnight Hunt","MID","Standard","$300",True,"Eternal Night frames"),
 ("Innistrad: Crimson Vow","VOW","Standard","$300",True,"Fang-frame showcases"),
]),
("Expansion Era — 2022", [
 ("Kamigawa: Neon Dynasty","NEO","Standard","$360",False,"Ukiyo-e & neon ink foils"),
 ("Streets of New Capenna","SNC","Standard","$360",False,"Art Deco showcases"),
 ("Commander Legends: Baldur's Gate","CLB","Reprint","$280",True,"Foil-etched legends"),
 ("Double Masters 2022","2X2","Reprint","$330",True,"Textured-foil double rares"),
 ("Dominaria United","DMU","Standard","$360",False,"Textured-foil legends"),
 ("Unfinity","UNF","Special","$280",True,"Galaxy/space foils (un-set)"),
 ("The Brothers' War","BRO","Standard","$487",False,"Transformers Shattered Glass"),
]),
("Golden Era — 2023", [
 ("Dominaria Remastered","DMR","Reprint","$300",True,"Retro-frame reprints"),
 ("Phyrexia: All Will Be One","ONE","Standard","$815",False,"Step-and-Compleat foils"),
 ("March of the Machine","MOM","Standard","$570",False,"Serialized Praetors"),
 ("March of the Machine: Aftermath","MAT","Standard","$170",True,"Small epilogue (mini box)"),
 ("LotR: Tales of Middle-earth","LTR","Univ. Beyond","$1,150",False,"1-of-1 One Ring set"),
 ("LotR: Middle-earth — Special Ed.","LTR","Special","$2,595",False,"All-foil premium edition"),
 ("Commander Masters","CMM","Reprint","$330",True,"High-end Cmdr reprints"),
 ("Wilds of Eldraine","WOE","Standard","$888",False,"Enchanting Tales; anime foils"),
 ("Doctor Who","WHO","Univ. Beyond","$455",False,"UB Commander set"),
 ("The Lost Caverns of Ixalan","LCI","Standard","$735",False,"Jurassic World; box topper"),
]),
("Play Booster Shift — 2024", [
 ("Ravnica Remastered","RVR","Reprint","$649",False,"Borderless shocklands"),
 ("Murders at Karlov Manor","MKM","Standard","$320",True,"Dossier showcases"),
 ("Fallout","PIP","Univ. Beyond","$1,260",False,"Serialized bobbleheads"),
 ("Outlaws of Thunder Junction","OTJ","Standard","$290",False,"Big Score bonus sheet"),
 ("Modern Horizons 3","MH3","Reprint","$600",False,"Serialized Eldrazi titans"),
 ("Assassin's Creed","ACR","Univ. Beyond","$245",False,"UB Beyond-booster set"),
 ("Bloomburrow","BLB","Standard","$800",False,"Critter showcases; popular"),
 ("Duskmourn: House of Horror","DSK","Standard","$531",False,"Japan Showcase; textured"),
 ("MTG Foundations","FDN","Standard","$653",False,"Core set; Mana Foil"),
]),
("Crossover Era — 2025", [
 ("Innistrad Remastered","INR","Reprint","$280",True,"Innistrad reprints"),
 ("Aetherdrift","DFT","Standard","$270",True,"Racing showcases"),
 ("Tarkir: Dragonstorm","TDM","Standard","$300",True,"Clan & dragon showcases"),
 ("Final Fantasy","FIN","Univ. Beyond","$1,059",False,"Best-selling set ever"),
 ("Edge of Eternities","EOE","Standard","$320",True,"Sci-fi; surge foils"),
 ("Marvel's Spider-Man","SPM","Univ. Beyond","$330",True,"First Marvel expansion"),
 ("Avatar: The Last Airbender","ATL","Univ. Beyond","$300",True,"Element showcases"),
]),
("Current Era — 2026", [
 ("Lorwyn Eclipsed","ECL","Standard","$300",True,"Faerie/tribal showcases"),
 ("Teenage Mutant Ninja Turtles","TMT","Univ. Beyond","$410",False,"Pizza Bundle cards separate"),
 ("Secrets of Strixhaven","SOS","Standard","$484",True,"Mystical Archive returns"),
 ("Marvel Super Heroes","MSH","Univ. Beyond","$671",True,"Pre-release; releases late Jun"),
]),
("Upcoming — Late 2026  (not yet released)", [
 ("The Hobbit","TBA","Univ. Beyond","TBA",False,"Aug 2026 • box-topper One Ring"),
 ("Reality Fracture","TBA","Standard","TBA",False,"Oct 2026 • Jace 'What If?' set"),
 ("Star Trek","TBA","Univ. Beyond","TBA",False,"Nov 2026 • UB; 60th anniversary"),
]),
("Premium / All-Foil / VIP Boxes  (collector-adjacent)", [
 ("Shards of Alara Premium Foil Booster Box","ALA","Special","$800",True,"12 all-foil packs (2010)"),
 ("Double Masters VIP Edition Box","2XM","Special","$900",True,"4 VIP packs; foil-loaded (2020)"),
]),
]

def _num(v):
    try: return int(str(v).replace("$","").replace(",","").replace("+",""))
    except: return 0
NBOX = sum(len(rows) for _, rows in ERAS)
NUPCOMING = sum(len(rows) for name, rows in ERAS if name.lower().startswith("upcoming"))
NREL = NBOX - NUPCOMING
TOTVAL = sum(_num(r[3]) for _, rows in ERAS for r in rows)

PAGE_W, PAGE_H = landscape(letter)   # 792 x 612
LM=RM=26; TM=24; BM=20; GUT=16; H1=96
COLW = (PAGE_W - LM - RM - GUT)/2.0   # ~362
TBLW = COLW
cols = [16, 120, 26, 56, 40, TBLW-258]  # chk,set,code,type,value,note  (sum=TBLW)

def make_frames(top_y):
    h = top_y - BM
    fL = Frame(LM, BM, COLW, h, leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
    fR = Frame(LM+COLW+GUT, BM, COLW, h, leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
    return [fL, fR]

def draw_header(canvas, doc):
    canvas.saveState()
    cx = PAGE_W/2.0
    y = PAGE_H - TM - 12
    canvas.setFillColor(PURPLE); canvas.setFont("Helvetica-Bold", 16)
    canvas.drawCentredString(cx, y, "Magic: The Gathering  —  Collector Booster Box Checklist")
    canvas.setFillColor(GREY); canvas.setFont("Helvetica", 8)
    canvas.drawCentredString(cx, y-13, "Every Collector Booster Display & collector-grade box, by era  •  Sealed market values as of June 2026")
    # stats
    sy = y-34
    stats = [(str(NBOX),"BOXES (%d OUT NOW)"%NREL),("~$%s+"%format(int(round(TOTVAL,-2)),","),"ONE OF EACH (APPROX.)"),("2010–2026","RELEASE SPAN")]
    sx = [cx-185, cx, cx+185]
    for (num,lbl),x in zip(stats,sx):
        canvas.setFillColor(LPURPLE); canvas.setFont("Helvetica-Bold",13)
        canvas.drawCentredString(x, sy, num)
        canvas.setFillColor(GREY); canvas.setFont("Helvetica",6)
        canvas.drawCentredString(x, sy-9, lbl)
    # legend
    ly = sy-24
    canvas.setFont("Helvetica",6.6)
    items = [("Standard",T_STD),("Reprint/Masters",T_REP),("Universes Beyond",T_UB),("Special",T_SPC)]
    seg_w = []
    for txt,_ in items: seg_w.append(8 + canvas.stringWidth(txt,"Helvetica",6.6) + 12)
    extra = "  •  amber value = estimate; others from recent TCGPlayer/PriceCharting sales — verify before buying."
    total = sum(seg_w) + canvas.stringWidth(extra,"Helvetica",6.6)
    x = cx - total/2.0
    for (txt,col),w in zip(items,seg_w):
        canvas.setFillColor(col); canvas.rect(x, ly-1, 6,6, stroke=0, fill=1)
        canvas.setFillColor(GREY); canvas.drawString(x+9, ly, txt)
        x += w
    canvas.setFillColor(GREY); canvas.drawString(x, ly, extra)
    # divider
    canvas.setStrokeColor(PURPLE); canvas.setLineWidth(1.5)
    canvas.line(LM, PAGE_H-TM-H1+6, PAGE_W-RM, PAGE_H-TM-H1+6)
    canvas.restoreState()

def era_block(era_name, rows):
    eh = Table([[Paragraph(era_name, era_st)]], colWidths=[TBLW])
    eh.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),PURPLE),
                            ("TOPPADDING",(0,0),(-1,-1),3),("BOTTOMPADDING",(0,0),(-1,-1),3),
                            ("LEFTPADDING",(0,0),(-1,-1),6),
                            ("ROUNDEDCORNERS",[2,2,0,0])]))
    head=[Paragraph("",hdr_cell),Paragraph("SET",hdr_cell),Paragraph("CODE",hdr_cell),
          Paragraph("TYPE",hdr_cell),Paragraph("VALUE",hdr_cell),Paragraph("HIGHLIGHT",hdr_cell)]
    data=[head]
    for (s,code,typ,val,est,note) in rows:
        if val=="TBA":
            vstyle = val_tba; vtxt = "TBA"
        else:
            vstyle = val_est if est else val_st
            vtxt = ("~"+val) if est else val
        data.append([Checkbox(),Paragraph(s,cell_b),Paragraph(code,cell_code),
                     tag_for(typ),Paragraph(vtxt,vstyle),Paragraph(note,cell_note)])
    t=Table(data,colWidths=cols,repeatRows=1)
    ts=[("BACKGROUND",(0,0),(-1,0),HEADBG),
        ("LINEBELOW",(0,0),(-1,0),1,colors.HexColor("#c9bfe8")),
        ("LINEBELOW",(0,1),(-1,-1),0.4,GRID),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
        ("ALIGN",(0,0),(0,-1),"CENTER"),("ALIGN",(3,0),(3,-1),"CENTER"),
        ("TOPPADDING",(0,0),(-1,-1),2.6),("BOTTOMPADDING",(0,0),(-1,-1),2.6),
        ("LEFTPADDING",(0,0),(-1,-1),4),("RIGHTPADDING",(0,0),(-1,-1),4)]
    for i in range(1,len(data)):
        if i%2==0: ts.append(("BACKGROUND",(0,i),(-1,i),ROWALT))
    t.setStyle(TableStyle(ts))
    return KeepTogether([eh, t, Spacer(1,6)])

doc = BaseDocTemplate("mtg_collector_checklist.pdf", pagesize=landscape(letter),
                      leftMargin=LM,rightMargin=RM,topMargin=TM,bottomMargin=BM,
                      title="MTG Collector Booster Box Checklist")
first = PageTemplate(id="first", frames=make_frames(PAGE_H-TM-H1), onPage=draw_header)
later = PageTemplate(id="later", frames=make_frames(PAGE_H-TM))
doc.addPageTemplates([first, later])

story=[NextPageTemplate("later")]
for name,rows in ERAS:
    story.append(era_block(name,rows))

notes_html=("<b>Notes.</b> &bull; The <b>Shards of Alara Premium Foil Booster Box</b> (Jan 2010) is the only block-wide all-foil "
 "booster product MTG ever made — the 'Alara all-foil box' collectors ask about. &bull; The <b>Double Masters VIP Edition Box</b> "
 "holds 4 foil-loaded VIP packs. &bull; <b>Innistrad: Double Feature</b> is all-foil but <i>draftable</i>, so it lives on the standard "
 "Booster Box checklist, not here. &bull; <b>Ravnica Allegiance</b> "
 "(2019) had the first-ever Collector Boosters but only as single packs — no display box. &bull; No-Collector-Booster sets are "
 "omitted: pre-2019 sets, Modern Horizons 1, Jumpstart, most Commander precons, Warhammer 40,000. &bull; <b>2027:</b> Wizards has "
 "confirmed six more sets (three in-universe, three Universes Beyond) — names &amp; dates not yet announced. &bull; <b>Prices move</b> — "
 "confirm live values on TCGPlayer, PriceCharting or MTGStocks before buying.")
nb=Table([[Paragraph(notes_html,note_box_st)]],colWidths=[TBLW])
nb.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),colors.HexColor("#f5f2fc")),
                        ("BOX",(0,0),(-1,-1),0.6,colors.HexColor("#d9cff0")),
                        ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5),
                        ("LEFTPADDING",(0,0),(-1,-1),7),("RIGHTPADDING",(0,0),(-1,-1),7)]))
story.append(KeepTogether([nb, Spacer(1,4),
    Paragraph("Compiled June 2026 &bull; %d boxes (%d released) &bull; approximate secondary-market values (Draftsim, PriceCharting, MTGStocks, " % (NBOX, NREL) +
              "TCGPlayer). MTG is &copy; Wizards of the Coast. Unofficial fan reference.", foot_st)]))

doc.build(story)
print("built")
