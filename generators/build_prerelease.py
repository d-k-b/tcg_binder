# -*- coding: utf-8 -*-
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, Flowable, KeepTogether,
                                NextPageTemplate)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
import math

PURPLE = colors.HexColor("#3a2d6b")
LPURPLE = colors.HexColor("#6a4fb0")
HEADBG = colors.HexColor("#ece8f7")
ROWALT = colors.HexColor("#faf9fd")
GRID = colors.HexColor("#e4e0ef")
AMBER = colors.HexColor("#b5852a")
GREY = colors.HexColor("#666666")
GOLD = colors.HexColor("#b5852a")

styles = getSampleStyleSheet()
cell = ParagraphStyle("cell", parent=styles["Normal"], fontSize=7.2, leading=8.4)
cell_b = ParagraphStyle("cellb", parent=cell, fontName="Helvetica-Bold")
cell_code = ParagraphStyle("code", parent=cell, textColor=GREY, fontSize=6.8)
cell_yr = ParagraphStyle("yr", parent=cell, textColor=GREY, fontSize=6.8, alignment=1)
cell_note = ParagraphStyle("note", parent=cell, fontSize=6.6, textColor=colors.HexColor("#555555"), leading=8)
note_gold = ParagraphStyle("noteg", parent=cell_note, textColor=GOLD, fontName="Helvetica-Bold")
cnt = ParagraphStyle("cnt", parent=cell, alignment=1, fontName="Helvetica-Bold", textColor=LPURPLE, fontSize=7.4)
cnt_g = ParagraphStyle("cntg", parent=cnt, textColor=GOLD)
era_st = ParagraphStyle("era", parent=styles["Normal"], fontSize=9, textColor=colors.white, fontName="Helvetica-Bold", leading=10.5)
era_cnt = ParagraphStyle("erac", parent=era_st, alignment=2, fontSize=8)
hdr_cell = ParagraphStyle("hc", parent=styles["Normal"], fontSize=5.8, fontName="Helvetica-Bold", textColor=PURPLE, alignment=1)
hdr_l = ParagraphStyle("hl", parent=hdr_cell, alignment=0)
note_box_st = ParagraphStyle("nb", parent=styles["Normal"], fontSize=6.7, leading=9.4, textColor=colors.HexColor("#333333"))
foot_st = ParagraphStyle("foot", parent=styles["Normal"], fontSize=6, textColor=colors.HexColor("#888888"), leading=8)

class MultiCheck(Flowable):
    """N checkboxes (one per variant), wrapping at per_row."""
    def __init__(self, n, color=LPURPLE, size=7.5, gap=3.0, per_row=5):
        super().__init__()
        self.n=n; self.color=color; self.size=size; self.gap=gap; self.per_row=per_row
        rows=max(1, math.ceil(n/per_row))
        self.width=per_row*(size+gap)
        self.height=rows*(size+gap)-gap
    def draw(self):
        c=self.canv; c.setStrokeColor(self.color); c.setLineWidth(1)
        s=self.size; g=self.gap
        for i in range(self.n):
            r=i//self.per_row; col=i%self.per_row
            x=col*(s+g); y=self.height - s - r*(s+g)
            c.roundRect(x,y,s,s,1.2,stroke=1,fill=0)

# (set, code, year, variants, est, note)
ERAS = [
("Ravnica & Theros Blocks — 2012–2014", [
 ("Return to Ravnica","RTR","'12",5,False,"5 guild packs"),
 ("Gatecrash","GTC","'13",5,False,"5 guild packs"),
 ("Dragon's Maze","DGM","'13",10,False,"10 guild packs (RTR+GTC seeded)"),
 ("Magic 2014","M14","'13",1,False,""),
 ("Theros","THS","'13",5,False,"5 Hero's Path (colors)"),
 ("Born of the Gods","BNG","'14",5,False,"5 Hero packs"),
 ("Journey into Nyx","JOU","'14",5,False,"5 Hero packs"),
 ("Magic 2015","M15","'14",1,False,"Garruk challenge card"),
 ("Khans of Tarkir","KTK","'14",5,False,"5 clan packs"),
]),
("Tarkir, Origins & Battle for Zendikar — 2015–2017", [
 ("Fate Reforged","FRF","'15",5,False,"5 clan packs"),
 ("Dragons of Tarkir","DTK","'15",1,False,"Dragonfury event"),
 ("Magic Origins","ORI","'15",5,False,"5 planeswalker colors"),
 ("Battle for Zendikar","BFZ","'15",1,False,""),
 ("Oath of the Gatewatch","OGW","'16",1,False,""),
 ("Shadows over Innistrad","SOI","'16",1,False,""),
 ("Eldritch Moon","EMN","'16",1,False,""),
 ("Kaladesh","KLD","'16",1,False,""),
 ("Aether Revolt","AER","'17",1,False,""),
 ("Amonkhet","AKH","'17",1,False,""),
 ("Hour of Devastation","HOU","'17",1,False,""),
]),
("Ixalan to War of the Spark — 2017–2019", [
 ("Ixalan","XLN","'17",1,False,""),
 ("Rivals of Ixalan","RIX","'18",1,False,""),
 ("Dominaria","DOM","'18",1,False,""),
 ("Core Set 2019","M19","'18",1,False,""),
 ("Guilds of Ravnica","GRN","'18",5,False,"5 guild packs"),
 ("Ravnica Allegiance","RNA","'19",5,False,"5 guild packs"),
 ("War of the Spark","WAR","'19",1,False,""),
 ("Core Set 2020","M20","'19",1,False,""),
]),
("Eldraine to Crimson Vow — 2019–2021", [
 ("Throne of Eldraine","ELD","'19",1,False,""),
 ("Theros Beyond Death","THB","'20",1,False,""),
 ("Ikoria: Lair of Behemoths","IKO","'20",1,False,""),
 ("Core Set 2021","M21","'20",1,False,""),
 ("Zendikar Rising","ZNR","'20",1,False,""),
 ("Kaldheim","KHM","'21",1,False,""),
 ("Strixhaven: School of Mages","STX","'21",5,False,"5 college packs"),
 ("Adventures in the Forgotten Realms","AFR","'21",1,False,""),
 ("Innistrad: Midnight Hunt","MID","'21",1,False,""),
 ("Innistrad: Crimson Vow","VOW","'21",1,False,""),
]),
("Neon Dynasty to Lost Caverns — 2022–2023", [
 ("Kamigawa: Neon Dynasty","NEO","'22",1,False,""),
 ("Streets of New Capenna","SNC","'22",5,False,"5 family packs"),
 ("Dominaria United","DMU","'22",1,False,""),
 ("The Brothers' War","BRO","'22",1,False,""),
 ("Phyrexia: All Will Be One","ONE","'23",1,False,""),
 ("March of the Machine","MOM","'23",1,False,""),
 ("LotR: Tales of Middle-earth","LTR","'23",1,False,"UB"),
 ("Wilds of Eldraine","WOE","'23",1,False,""),
 ("The Lost Caverns of Ixalan","LCI","'23",1,False,""),
]),
("Karlov Manor to Foundations — 2024", [
 ("Murders at Karlov Manor","MKM","'24",1,False,""),
 ("Outlaws of Thunder Junction","OTJ","'24",1,False,""),
 ("Bloomburrow","BLB","'24",1,False,""),
 ("Duskmourn: House of Horror","DSK","'24",1,False,""),
 ("Magic: The Gathering Foundations","FDN","'24",1,False,""),
]),
("Aetherdrift to Avatar — 2025", [
 ("Aetherdrift","DFT","'25",1,False,""),
 ("Tarkir: Dragonstorm","TDM","'25",1,False,""),
 ("Final Fantasy","FIN","'25",1,False,"UB"),
 ("Edge of Eternities","EOE","'25",1,False,""),
 ("Marvel's Spider-Man","SPM","'25",1,True,"UB"),
 ("Avatar: The Last Airbender","ATL","'25",1,True,"UB"),
]),
("Lorwyn Eclipsed & Beyond — 2026  (some projected)", [
 ("Lorwyn Eclipsed","ECL","'26",1,False,""),
 ("Teenage Mutant Ninja Turtles","TMT","'26",1,True,"UB"),
 ("Secrets of Strixhaven","SOS","'26",5,True,"5 college packs (projected)"),
 ("Marvel Super Heroes","MSH","'26",1,True,"UB; late Jun"),
 ("The Hobbit","TBA","'26",1,True,"Aug 2026 • UB • projected"),
 ("Reality Fracture","TBA","'26",1,True,"Oct 2026 • projected"),
 ("Star Trek","TBA","'26",1,True,"Nov 2026 • UB • projected"),
]),
]

PAGE_W, PAGE_H = landscape(letter)
LM=RM=24; TM=22; BM=18; GUT=14; H1=86
COLW = (PAGE_W - LM - RM - GUT)/2.0
TBLW = COLW
# set, code, year, #, checkboxes, note
cols = [122, 28, 24, 20, 58, TBLW-252]

def make_frames(top_y):
    h = top_y - BM
    fL = Frame(LM, BM, COLW, h, leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
    fR = Frame(LM+COLW+GUT, BM, COLW, h, leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
    return [fL, fR]

GRAND = sum(r[3] for _,rows in ERAS for r in rows)
NSETS = sum(len(rows) for _,rows in ERAS)

def draw_header(canvas, doc):
    canvas.saveState()
    cx = PAGE_W/2.0
    y = PAGE_H - TM - 11
    canvas.setFillColor(PURPLE); canvas.setFont("Helvetica-Bold", 15)
    canvas.drawCentredString(cx, y, "Magic: The Gathering  —  Prerelease Pack Checklist  (one of every variant)")
    canvas.setFillColor(GREY); canvas.setFont("Helvetica", 7.3)
    canvas.drawCentredString(cx, y-12, "Modern purchasable Prerelease Packs, Return to Ravnica (2012) on.  One checkbox per variant — faction sets (guild / clan / color / college) have several.")
    sy = y-30
    stats = [(str(GRAND), "PRERELEASE PACKS"),(str(NSETS), "SETS"),("2012–2026","SPAN")]
    sx = [cx-170, cx, cx+170]
    for (n,lbl),x in zip(stats,sx):
        canvas.setFillColor(LPURPLE); canvas.setFont("Helvetica-Bold",12.5)
        canvas.drawCentredString(x, sy, n)
        canvas.setFillColor(GREY); canvas.setFont("Helvetica",6)
        canvas.drawCentredString(x, sy-9, lbl)
    ly = sy-21
    canvas.setFont("Helvetica",6.5)
    msg=("Most sets = 1 generic pack (1 box).  Faction sets have one variant per guild/clan/color/college — e.g. Dragon's Maze had 10.  Excludes pre-2012 sets (events only), Masters/reprint/Commander/supplemental sets, and Collector-only UB sets — none had purchasable Prerelease Packs.")
    canvas.setFillColor(GREY); canvas.drawCentredString(cx, ly, msg)
    canvas.setStrokeColor(PURPLE); canvas.setLineWidth(1.5)
    canvas.line(LM, PAGE_H-TM-H1+6, PAGE_W-RM, PAGE_H-TM-H1+6)
    canvas.restoreState()

def era_block(era_name, rows):
    sub = sum(r[3] for r in rows)
    eh = Table([[Paragraph(era_name, era_st), Paragraph("%d packs"%sub, era_cnt)]],
               colWidths=[TBLW*0.72, TBLW*0.28])
    eh.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),PURPLE),
                            ("TOPPADDING",(0,0),(-1,-1),3),("BOTTOMPADDING",(0,0),(-1,-1),3),
                            ("LEFTPADDING",(0,0),(0,0),6),("RIGHTPADDING",(1,0),(1,0),6),
                            ("VALIGN",(0,0),(-1,-1),"MIDDLE")]))
    head=[Paragraph("SET",hdr_l),Paragraph("CODE",hdr_l),Paragraph("YR",hdr_cell),
          Paragraph("#",hdr_cell),Paragraph("COLLECT (1 EACH)",hdr_cell),Paragraph("VARIANT",hdr_l)]
    data=[head]
    for (s,code,yr,nv,est,note) in rows:
        multi = nv>1
        cstyle = cnt_g if multi else cnt
        nstyle = note_gold if multi else cell_note
        ncol = GOLD if multi else LPURPLE
        ntxt = note + (" • projected" if (est and "projected" not in note) else "")
        data.append([Paragraph(s,cell_b),Paragraph(code,cell_code),Paragraph(yr,cell_yr),
                     Paragraph(str(nv),cstyle),MultiCheck(nv,ncol),Paragraph(ntxt,nstyle)])
    t=Table(data,colWidths=cols,repeatRows=1)
    ts=[("BACKGROUND",(0,0),(-1,0),HEADBG),
        ("LINEBELOW",(0,0),(-1,0),1,colors.HexColor("#c9bfe8")),
        ("LINEBELOW",(0,1),(-1,-1),0.4,GRID),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
        ("ALIGN",(2,0),(4,-1),"CENTER"),("ALIGN",(4,0),(4,-1),"LEFT"),
        ("TOPPADDING",(0,0),(-1,-1),2.4),("BOTTOMPADDING",(0,0),(-1,-1),2.4),
        ("LEFTPADDING",(0,0),(-1,-1),4),("RIGHTPADDING",(0,0),(-1,-1),4)]
    for i in range(1,len(data)):
        if i%2==0: ts.append(("BACKGROUND",(0,i),(-1,i),ROWALT))
    t.setStyle(TableStyle(ts))
    return KeepTogether([eh, t, Spacer(1,5)])

doc = BaseDocTemplate("mtg_prerelease_checklist.pdf", pagesize=landscape(letter),
                      leftMargin=LM,rightMargin=RM,topMargin=TM,bottomMargin=BM,
                      title="MTG Prerelease Pack Checklist")
first = PageTemplate(id="first", frames=make_frames(PAGE_H-TM-H1), onPage=draw_header)
later = PageTemplate(id="later", frames=make_frames(PAGE_H-TM))
doc.addPageTemplates([first, later])

story=[NextPageTemplate("later")]
for name,rows in ERAS:
    story.append(era_block(name,rows))

notes_html=("<b>How to use this.</b> Each set lists how many distinct Prerelease Packs it had (<b>#</b>) with one checkbox per variant &mdash; "
 "tick each as you get it. <b><font color='#b5852a'>Gold rows</font></b> are the multi-variant 'choose a faction' sets. &bull; "
 "<b>Faction breakdowns:</b> guild sets = the 5 (or 10) Ravnica guilds; Tarkir = the 5 clans (Abzan, Jeskai, Sultai, Mardu, Temur); "
 "Theros block = 5 colors/Hero paths; Origins = 5 planeswalker colors; Strixhaven / Secrets of Strixhaven = 5 colleges; New Capenna = "
 "5 crime families; Dragon's Maze = all 10 guilds. &bull; <b>Scope:</b> the modern, purchasable Prerelease Pack began with Return to "
 "Ravnica (Sept 2012). Earlier sets held prerelease events with promo cards but no standardized take-home box. &bull; <b>Excluded</b> "
 "(no Prerelease Pack): Masters/reprint sets, Commander sets, supplemental/Jumpstart sets, Modern Horizons, and Collector-only UB sets "
 "(Doctor Who, Fallout, Warhammer 40K, Assassin's Creed). &bull; 2025–2026 UB and unreleased sets marked 'projected' — confirm at release.")
nb=Table([[Paragraph(notes_html,note_box_st)]],colWidths=[TBLW])
nb.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),colors.HexColor("#f5f2fc")),
                        ("BOX",(0,0),(-1,-1),0.6,colors.HexColor("#d9cff0")),
                        ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5),
                        ("LEFTPADDING",(0,0),(-1,-1),7),("RIGHTPADDING",(0,0),(-1,-1),7)]))
story.append(KeepTogether([nb, Spacer(1,4),
    Paragraph("Compiled June 2026 &bull; %d prerelease packs across %d sets &bull; per-set variant data from MTG Wiki Prerelease page. "
              "MTG is &copy; Wizards of the Coast. Unofficial fan reference." % (GRAND, NSETS), foot_st)]))

doc.build(story)
print("built; total prerelease packs =", GRAND, "across", NSETS, "sets")
