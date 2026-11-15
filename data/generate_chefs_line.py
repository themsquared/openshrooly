"""Build the Chef's line paid culinary profiles.

Each profile starts from the free culinary card for the same species and
overrides the stages and light recipe that make the chef method different.
Every changed setpoint is tied to a source in source_notes or light_recipe.

Run from the repo root:  python3 data/generate_chefs_line.py
Writes data/profiles/culinary/<id>.json and checks the round trip.
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared"))

from openshrooly_lib.mapping import brightness_percent_to_lux  # noqa: E402
from openshrooly_lib.schema import validate_profile  # noqa: E402

OUT = ROOT / "data" / "profiles" / "culinary"

CHAMBER = (
    "Chamber limits: there is no heater or cooler, so temperature targets only hold if the room "
    "sits near them. There is no CO2 sensor, so the fan schedule stands in for fresh air. "
    "The humidifier can only add moisture, so a low humidity target depends on dry room air."
)
WAVES = (
    "WS2812 red is roughly 620 to 630 nm and blue roughly 465 to 475 nm. The RGB mix is an "
    "approximation of the cited wavelengths, not a measured spectrum. RGB percent is LED drive "
    "level, not a photon ratio."
)


def src(title, detail, url=None):
    out = {"title": title, "detail": detail}
    if url:
        out["url"] = url
    return out


def phase(hours, white, red=0, green=0, blue=0):
    return {
        "photoperiod_hours": hours,
        "white_brightness_percent": white,
        "red_percent": red,
        "green_percent": green,
        "blue_percent": blue,
    }


DARK = phase(0, 0)

# Sources. Each detail states what the source says and how it is used.
MM_LIONS = src(
    "The Mushroom Magazine 2022 lion's mane factory",
    "Inside the Factory: Lion's Mane, The Mushroom Magazine, Feb 2022. Fruiting runs 14 to 25 °C with "
    "16 to 18 °C as the ideal. Cooler rooms give denser heads, warmer rooms looser heads with longer "
    "spines. CO2 above 0.1% gives coral-like branching. Fruits grow best in shade. Heads are cut 7 to "
    "12 days after they appear, before the spines lengthen.",
    "https://digital.themushroom.pub/feb-2022/inside-the-factory-lions-mane/",
)
CHEN_SHIITAKE = src(
    "Chen, MushWorld 2004, shiitake",
    "Alice W. Chen, Growing Shiitake Mushrooms, Mushroom Growers' Handbook 1, ch. 11, MushWorld 2004. "
    "Huagu (flower shiitake) and dongu (winter shiitake) are thick caps made at winter-like temperatures. "
    "Huagu forcing starts when buttons are 2 to 3 cm. Under 1.5 cm buttons can die; over 3.5 cm they do "
    "not respond. Cold, dry air with large day-night swings dries the cap skin while the flesh keeps "
    "growing, which cracks the cap. Use a cold-tolerant strain. The Stamets table in the chapter gives "
    "primordia induction at 10 to 16 °C for cold strains, 95 to 100% RH, development at 60 to 80% RH, and "
    "500 to 2,000 lux, with long stems under 500 lux. Lower humidity to 60% for 6 to 12 h before harvest.",
    "https://www.fungifun.org/docs/mushworld/Oyster-Mushroom-Cultivation/mushroom-growers-handbook-1-mushworld-com-chapter-11-1.pdf",
)
SUGIMOTO = src(
    "Sugimoto, Donko and Koshin",
    "Sugimoto Co., Donko and Koshin, forest-grown shiitake (2021). Donko is picked with the cap under "
    "70% open and the edge still curled in. Most donko comes from the cool season, and cooler weather "
    "gives thicker caps.",
    "https://sugimoto.co/en/blog/2021/07/Donko-and-Koshin/",
)
DONG_CORDY = src(
    "Dong et al. 2013, Cordyceps militaris light quality",
    "Dong J. Z. et al., Journal of Food Biochemistry 37 (2013). Pink light, one third at 450 to 460 nm "
    "and two thirds at 620 to 630 nm, gave the highest dry matter (40.06%) and bioefficiency and raised "
    "carotenoid and cordycepin content. Daylight was not suitable.",
    "https://doi.org/10.1111/jfbc.12009",
)
MW_OYSTER = src(
    "MushWorld 2004, oyster abnormalities",
    "Mushroom Growers' Handbook 1, ch. 8, MushWorld 2004. P. ostreatus fruits best at 13 to 16 °C and "
    "over 80% RH. Low temperature with high humidity gives strong color and firm fruits that grow slowly; "
    "high temperature gives lighter caps. At 0.03% CO2 caps were 6.5 mm with 4.6 mm stipes; at 0.1% caps "
    "were 3.4 mm with 6.8 mm stipes. Too much air movement also deforms fruits.",
    "https://www.fungifun.org/docs/mushworld/Oyster-Mushroom-Cultivation/mushroom-growers-handbook-1-mushworld-com-chapter-8-4.pdf",
)
SARE_OYSTER = src(
    "FungiAlly oyster booklet, SARE",
    "FungiAlly, oyster mushroom production booklet, SARE project. Fruiting at 85 to 90% RH with CO2 below "
    "800 ppm. Harvest 5 to 10 days into fruiting, before the cap edges flatten. A slight roll on the edge "
    "keeps texture and storage life. High CO2 gives long stems and little caps.",
    "https://projects.sare.org/media/pdf/F/u/n/FungiAlly_Oyster_booklet_Final.pdf",
)
BRAZIL_OYSTER = src(
    "Scientia Agricola 2003, oyster cap color",
    "Scientia Agricola 60(3), 2003. P. ostreatus fruited at 15 °C with 120 lux for 12 h and 85 to 90% RH "
    "gave grey to lead-colored caps. At 28 °C with 900 lux the caps were white.",
    "https://doi.org/10.1590/S0103-90162003000300018",
)
MAPA_OYSTER = src(
    "MAPA 1985 oyster leaflet",
    "Ministerio de Agricultura, Hojas Divulgadoras 8/85, Spain. Fruiting at 12 to 14 °C, 85 to 95% RH, "
    "CO2 under 0.06%, and 60 to 300 lux for about 12 h. Too little light gives pale caps and long stems.",
    "https://www.mapa.gob.es/ministerio/pags/biblioteca/hojas/hd_1985_08.pdf",
)
FRONT_GOLDEN = src(
    "Chen et al. 2025, golden oyster light quality",
    "Chen X. et al., Frontiers in Nutrition 12 (2025). Under pure blue light (450 nm, 12 h) stipes were "
    "12.5% shorter than under white, stipe and cap diameter rose 35.5% and 18.3%, fruit weight rose 23.7%, "
    "color was fuller, and umami and sweet amino acids rose. Red and far-red light gave pale, soft fruits.",
    "https://doi.org/10.3389/fnut.2025.1554575",
)
IJMM_GOLDEN = src(
    "IJMM 2013, golden oyster light and atmosphere",
    "International Journal of Medicinal Mushrooms 15(1), 2013. The yellow value of P. citrinopileatus was "
    "highest at 0.1% CO2, and 0.05 to 0.1% CO2 improved yield. That is why this profile uses moderate "
    "rather than maximum fresh air. Its light advice (720 nm) differs from the 2025 study; this profile "
    "follows the 2025 blue light result because far-red gave pale fruits there.",
    "https://doi.org/10.1615/IntJMedMushr.v15.i1.110",
)
BLUE_DJAMOR = src(
    "Guzman-de-Casa et al. 2026, blue light in five mushrooms",
    "Plant Foods for Human Nutrition (2026). Blue light at 8 h a day raised P. djamor biological "
    "efficiency by 428% compared with darkness and gave normal pigmented fruits. Darkness gave long "
    "stipes, weak color, and malformed fruits. The comparison was blue light against darkness, not "
    "against white light.",
    "https://doi.org/10.1007/s11130-026-01555-4",
)
BIORES_DJAMOR = src(
    "Chowdhury et al. 2024, pink oyster",
    "BioResources 19(1), 2024. P. djamor grows well up to 30 °C, with mycelium best at 24 to 28 °C, and "
    "fruits within 1 to 2 weeks of conditions being right.",
    "https://doi.org/10.15376/biores.19.1.1696-1706",
)
INATOMI_SHIMEJI = src(
    "Inatomi et al. 2002, Hokuto shimeji light",
    "Inatomi S. et al., Hokuto Corporation and Shinshu University, 2002. 50 lux during spawn run raised "
    "yield. At initiation, darkness gave no primordia; 2 lux gave the most primordia, the highest yield, "
    "and the longest stipes; caps were largest at 30 to 100 lux. During development, stipe elongation fell "
    "as light rose toward 2,000 lux, caps were largest at 500 lux, yield peaked at 200 to 500 lux, and "
    "color turned dark greyish brown above 100 lux.",
    "https://www.jstage.jst.go.jp/article/apmsb/10/3/10_KJ00007318151/_article/-char/en",
)
LIU_CHESTNUT = src(
    "Liu et al. 2024, Pholiota adiposa light quality",
    "Liu Y. et al., Spectroscopy and Spectral Analysis 44(08), 2024. In a 12 h light plant factory, pure "
    "red light raised stipe growth by 78.4% and fruit mass by 90.0% compared with white light. Blue light "
    "made thicker stipes and wider caps instead.",
    "https://www.gpxygpfx.com/EN/10.3964/j.issn.1000-0593(2024)08-2326-08",
)
CELLS_WOODEAR = src(
    "Qiu et al. 2023, wood ear light intensity",
    "Cells 12(1):56, 2023. A. heimuer fruits grew darker as light rose from 10 to 500 umol per m2 per s, "
    "with the most melanin at the highest level.",
    "https://doi.org/10.3390/cells12010056",
)
AGRI_WOODEAR = src(
    "Agriculture 2026, wood ear blue light",
    "Agriculture 16(19):2167, 2026. Melanin build-up in A. heimuer was tied to blue light treatment.",
    "https://doi.org/10.3390/agriculture16192167",
)
KOREA_KING = src(
    "Journal of Life Science 2007, king oyster ventilation",
    "Effects of various ventilation systems on CO2 and fruiting of P. eryngii in bottles, Journal of "
    "Life Science 17(1), 2007. The ventilation that held about 800 ppm CO2 beat a system at about 1,400 "
    "ppm for stipe length, cap diameter, yield, and quality, and cut rot.",
    "https://doi.org/10.5352/jls.2007.17.1.082",
)


def load(card):
    return json.loads((OUT / f"{card}.json").read_text())


def stage_from(base_stage, **kw):
    st = copy.deepcopy(base_stage)
    fan = kw.pop("fan", None)
    for k, v in kw.items():
        st[k] = float(v) if k in ("duration_days", "humidity_percent", "temperature_c") else v
    if "temperature_c" in kw:
        t = float(kw["temperature_c"])
        st["temperature_warning_min_c"] = float(kw.get("temperature_warning_min_c", t - 5))
        st["temperature_warning_max_c"] = float(kw.get("temperature_warning_max_c", t + 5))
    if fan:
        st["fan"] = {"period_min": fan[0], "run_duration_s": fan[1], "speed_percent": fan[2]}
    return st


def build(pid, base, *, name, strain, tags, price, summary, notes, chamber, sources,
          stages, phases, why, recipe_sources, keep_base_recipe_sources=()):
    d = load(base)
    d["id"] = pid
    d["name"] = name
    d["strain"] = strain
    d["tags"] = tags
    d["summary"] = summary
    d["notes"] = notes
    d["chamber_notes"] = chamber + " " + CHAMBER
    base_sources = [s for s in d["source_notes"] if s["title"] in ("Stamets",)]
    d["source_notes"] = sources + base_sources
    by_id = {s["id"]: s for s in d["stages"]}
    out_stages = []
    for sid, kw in stages:
        base_stage = by_id.get(sid) or by_id.get(kw.pop("_like"))
        if "_like" in kw:
            kw.pop("_like")
        st = stage_from(base_stage, id=sid, **kw)
        ph = phases[sid]
        st["light"] = {
            "sunrise_hour": st["light"].get("sunrise_hour", 8),
            "duration_hours": ph["photoperiod_hours"],
            "white_led_lux": brightness_percent_to_lux(ph["white_brightness_percent"]),
            "red_percent": ph["red_percent"],
            "green_percent": ph["green_percent"],
            "blue_percent": ph["blue_percent"],
        }
        out_stages.append(st)
    d["stages"] = out_stages
    kept = [s for s in d["light_recipe"]["sources"] if s["title"] in keep_base_recipe_sources]
    d["light_recipe"] = {
        "why": why,
        "wavelength_note": WAVES,
        "sources": recipe_sources + kept,
        "phases": {sid: phases[sid] for sid, _ in stages},
    }
    d["pricing"] = {"kind": "paid", "amount_cents": price, "currency": "USD", "creator_share_percent": 70}
    d["allowed_payment_providers"] = ["stripe"]
    d["author"] = None
    d["fork_of"] = None
    return d


def profiles():
    P = []
    P.append(build(
        "lions-mane-dense-head", "lions-mane",
        name="Lion's Mane: dense white heads", strain="Standard hericium",
        tags=["culinary", "chef", "intermediate", "medicinal"], price=399,
        summary="Cooler fruiting, shade, and steady fresh air for tight, heavy heads with short spines. Cut early for a crab-like texture.",
        notes="Cut the head when it is firm and the spines are still short, before they lengthen. Cooler rooms can give a faint pink blush; it is harmless. If you see branching coral shapes, the air is too stale.",
        chamber="Keep the block upright with one opening so you get one big head instead of many small ones.",
        sources=[MM_LIONS],
        stages=[
            ("colonization", {}),
            ("pinning", dict(duration_days=6, temperature_c=18, humidity_percent=94, fan=(15, 30, 30),
                             notes="Shade and cool air. One cluster per opening.")),
            ("fruiting", dict(duration_days=10, temperature_c=16, humidity_percent=90, fan=(10, 40, 40),
                              notes="Cut 7 to 12 days after the head appears, before the spines lengthen.")),
        ],
        phases={"colonization": DARK, "pinning": phase(12, 10, blue=80), "fruiting": phase(12, 10, blue=80)},
        why="Dim light because the source says lion's mane grows best in shade. 10% white is about 46 lux. Blue stays at the free card level.",
        recipe_sources=[MM_LIONS], keep_base_recipe_sources=("Jozifek et al. 2025", "Sakamoto 2018"),
    ))
    shiitake_common = [
        ("colonization", {}),
        ("browning", {}),
        ("cold_shock", {}),
    ]
    P.append(build(
        "shiitake-flower-cap", "shiitake",
        name="Shiitake: flower cap (huagu)", strain="Cold-tolerant shiitake",
        tags=["culinary", "chef", "advanced", "woodlover"], price=399,
        summary="The cracked white-patterned cap prized in Chinese cooking. Thick buttons, then cold dry air forces the skin to split while the flesh keeps growing.",
        notes="Start the dry stage only when most buttons are 2 to 3 cm across. If they are smaller, hold the Buttons stage longer. Pick before the caps flatten. Cracking is not guaranteed; a crack-free cap from this run is still a thick winter-style shiitake.",
        chamber="Use a cold-tolerant strain. Run it in a cool, dry room in winter. The chamber cannot make the large day and night swings the method relies on, so a room that cools at night helps.",
        sources=[CHEN_SHIITAKE],
        stages=shiitake_common + [
            ("pinning", dict(_like="fruiting", name="Buttons", duration_days=7, temperature_c=14, humidity_percent=95,
                             fan=(12, 35, 40), notes="Grow buttons to 2 to 3 cm before the dry stage.")),
            ("fruiting", dict(name="Dry forcing", duration_days=12, temperature_c=14, humidity_percent=60,
                              fan=(10, 60, 60), notes="Dry air hardens the cap skin while the flesh grows. Mist nothing.")),
        ],
        phases={"colonization": DARK, "browning": phase(12, 26, blue=80), "cold_shock": DARK,
                "pinning": phase(12, 37, blue=80), "fruiting": phase(12, 51, blue=80)},
        why="Shiitake caps need 500 to 2,000 lux in the cited table, and less than 500 lux gives long stems. 37% white is about 506 lux and 51% is about 1,229 lux. Browning keeps the free card light.",
        recipe_sources=[CHEN_SHIITAKE],
        keep_base_recipe_sources=("Koo 2018 shiitake browning LED", "Kim 2024 shiitake blue light"),
    ))
    P.append(build(
        "shiitake-donko", "shiitake",
        name="Shiitake: thick winter cap (donko)", strain="Cold-tolerant shiitake",
        tags=["culinary", "chef", "advanced", "woodlover"], price=299,
        summary="Slow, cool fruiting for the thick, rounded cap that dried-shiitake buyers pay the most for. Picked while the edge is still curled in.",
        notes="Pick when the cap is under 70% open and the edge still rolls under. Slow growth is the point; do not raise the temperature to speed it up.",
        chamber="Use a cold-tolerant strain and a cool room.",
        sources=[CHEN_SHIITAKE, SUGIMOTO],
        stages=shiitake_common + [
            ("pinning", dict(_like="fruiting", name="Cool pinning", duration_days=6, temperature_c=13, humidity_percent=95,
                             fan=(12, 35, 40), notes="Primordia at the cool end of the cold strain range.")),
            ("fruiting", dict(name="Slow cool caps", duration_days=14, temperature_c=15, humidity_percent=75,
                              fan=(12, 35, 40), notes="Pick under 70% open.")),
        ],
        phases={"colonization": DARK, "browning": phase(12, 26, blue=80), "cold_shock": DARK,
                "pinning": phase(12, 37, blue=80), "fruiting": phase(12, 37, blue=80)},
        why="Shiitake caps need 500 to 2,000 lux in the cited table, and less than 500 lux gives long stems. 37% white is about 506 lux. Browning keeps the free card light.",
        recipe_sources=[CHEN_SHIITAKE],
        keep_base_recipe_sources=("Koo 2018 shiitake browning LED", "Kim 2024 shiitake blue light"),
    ))
    P.append(build(
        "cordyceps-high-color", "cordyceps-militaris",
        name="Cordyceps: deep orange under pink light", strain="Cultivated militaris cordyceps",
        tags=["culinary", "chef", "advanced", "medicinal"], price=399,
        summary="Swaps white light for a red and blue pink mix during stroma growth, the light that gave the heaviest, most colorful fruit bodies in the cited trial.",
        notes="The pink mix starts after the orange initials form. Expect the stroma stage to take about five weeks.",
        chamber="This profile only sets climate. Media is on you.",
        sources=[DONG_CORDY],
        stages=[
            ("colonization", {}),
            ("pinning", {}),
            ("fruiting", dict(name="Stroma, pink light", notes="Red and blue only. White stays off.")),
        ],
        phases={"colonization": DARK, "pinning": phase(12, 51, blue=80), "fruiting": phase(12, 0, red=100, blue=50)},
        why="Initials keep the free card light. Stroma growth uses red at twice the blue drive level to approximate the two thirds red, one third blue pink light in Dong 2013. White is off because daylight did poorly in that trial.",
        recipe_sources=[DONG_CORDY], keep_base_recipe_sources=("Wu 2016 Cordyceps militaris", "Lin et al. 2024 Cordyceps LED"),
    ))
    P.append(build(
        "pearl-oyster-baby-clusters", "pearl-oyster",
        name="Pearl Oyster: baby clusters", strain="Pearl oyster",
        tags=["culinary", "chef", "beginner", "oyster"], price=299,
        summary="Lots of fresh air and an early pick for small, thick caps on short stems. The tender clusters restaurants serve whole.",
        notes="Pick the whole cluster while the cap edges still roll under, before any flatten. Expect a lighter harvest than a full-size grow.",
        chamber="",
        sources=[MW_OYSTER, SARE_OYSTER],
        stages=[
            ("colonization", {}),
            ("pinning", dict(duration_days=5, temperature_c=16, humidity_percent=93, fan=(10, 45, 45))),
            ("fruiting", dict(name="Baby fruiting", duration_days=6, temperature_c=15, humidity_percent=88, fan=(8, 60, 50),
                              notes="Strong but not maximum air. Too much air movement also deforms fruits.")),
        ],
        phases={"colonization": DARK, "pinning": phase(12, 20, blue=80), "fruiting": phase(12, 20, blue=80)},
        why="Light stays at the free card default. This profile changes air and timing, not light.",
        recipe_sources=[], keep_base_recipe_sources=("Penn State oyster production", "Wang 2020 blue versus red"),
    ))
    P.append(build(
        "pearl-oyster-dark-cap", "pearl-oyster",
        name="Pearl Oyster: dark cap", strain="Pearl oyster",
        tags=["culinary", "chef", "intermediate", "oyster"], price=299,
        summary="Cool fruiting with enough light for the deep grey-brown caps and firm flesh that warm, dim grows never give.",
        notes="Growth is slower than the free card. Darker color comes from cool air and light together.",
        chamber="Needs a cool room.",
        sources=[BRAZIL_OYSTER, MAPA_OYSTER, MW_OYSTER],
        stages=[
            ("colonization", {}),
            ("pinning", dict(duration_days=5, temperature_c=15, humidity_percent=93, fan=(12, 40, 45))),
            ("fruiting", dict(name="Cool dark caps", duration_days=10, temperature_c=13, humidity_percent=87, fan=(10, 45, 45))),
        ],
        phases={"colonization": DARK, "pinning": phase(12, 26, blue=80), "fruiting": phase(12, 26, blue=80)},
        why="26% white is about 190 lux: above the 120 lux that gave dark caps in Scientia Agricola 2003 and inside the 60 to 300 lux band in the MAPA leaflet.",
        recipe_sources=[BRAZIL_OYSTER, MAPA_OYSTER], keep_base_recipe_sources=("De Bonis 2024 LED wavelengths",),
    ))
    P.append(build(
        "golden-oyster-deep-yellow", "golden-oyster",
        name="Golden Oyster: deep yellow", strain="Golden",
        tags=["culinary", "chef", "intermediate", "oyster", "warm"], price=299,
        summary="Blue-only light and held-back fresh air for fuller yellow color, thicker stems, and more savory flavor than the free card.",
        notes="Do not raise the fan to fix long stems here; the blue light does that job. Harvest before the caps turn up at the edge.",
        chamber="",
        sources=[FRONT_GOLDEN, IJMM_GOLDEN],
        stages=[
            ("colonization", {}),
            ("pinning", {}),
            ("fruiting", dict(name="Blue fruiting", fan=(15, 35, 40))),
        ],
        phases={"colonization": DARK, "pinning": phase(12, 20, blue=80), "fruiting": phase(12, 0, blue=100)},
        why="Fruiting runs on blue only because pure blue gave fuller color, shorter stems, and more umami than white in Chen 2025.",
        recipe_sources=[FRONT_GOLDEN, IJMM_GOLDEN],
    ))
    P.append(build(
        "pink-oyster-bright", "pink-oyster",
        name="Pink Oyster: bright pink", strain="Pink oyster",
        tags=["culinary", "chef", "beginner", "oyster", "warm"], price=299,
        summary="Warm and blue-lit from pinning on, then picked young, for strong pink color and a fuller harvest than a dim grow.",
        notes="Pick young, as soon as the caps open and before the edges turn up.",
        chamber="Do not cold-shock.",
        sources=[BLUE_DJAMOR, BIORES_DJAMOR],
        stages=[
            ("colonization", {}),
            ("pinning", dict(duration_days=3, temperature_c=25, humidity_percent=93)),
            ("fruiting", dict(name="Blue fruiting", duration_days=5, temperature_c=26, humidity_percent=90, fan=(10, 45, 50))),
        ],
        phases={"colonization": DARK, "pinning": phase(8, 0, blue=100), "fruiting": phase(8, 0, blue=100)},
        why="Blue only at 8 h a day, the schedule that gave pigmented fruits and a large yield gain over darkness in the 2026 study.",
        recipe_sources=[BLUE_DJAMOR],
    ))
    P.append(build(
        "beech-shimeji-bouquet", "beech-shimeji",
        name="Beech Shimeji: tight bouquet", strain="Brown beech hypsizygus",
        tags=["culinary", "chef", "intermediate"], price=299,
        summary="A commercial light schedule: very dim light to set many pins, then brighter light for a tight bouquet of dark, round caps on firm stems.",
        notes="The dim pinning stage looks like almost nothing is on. That is intended.",
        chamber="",
        sources=[INATOMI_SHIMEJI],
        stages=[
            ("colonization", {}),
            ("pinning", dict(name="Dim pinning")),
            ("fruiting", dict(name="Bright fruiting", temperature_c=15, humidity_percent=90)),
        ],
        phases={"colonization": phase(12, 11), "pinning": phase(12, 1), "fruiting": phase(12, 37)},
        why="11% white is about 51 lux in spawn run. 1% white is about 5 lux, the dimmest step near the 2 lux that gave the most primordia. 37% white is about 506 lux, where caps were largest and yield peaked.",
        recipe_sources=[INATOMI_SHIMEJI],
    ))
    P.append(build(
        "chestnut-long-stem", "chestnut",
        name="Chestnut: long stem", strain="Chestnut pholiota",
        tags=["culinary", "chef", "intermediate"], price=299,
        summary="Red-only light during fruiting for longer, heavier stems, the crunchy part chefs want from chestnut mushrooms.",
        notes="Caps may sit a little smaller than on the free card. Pick before the veil tears.",
        chamber="",
        sources=[LIU_CHESTNUT],
        stages=[
            ("colonization", {}),
            ("pinning", {}),
            ("fruiting", dict(name="Red fruiting", temperature_c=15, humidity_percent=93)),
        ],
        phases={"colonization": DARK, "pinning": phase(12, 20, blue=80), "fruiting": phase(12, 0, red=100)},
        why="Pure red gave 78.4% more stipe growth and 90% more fruit mass than white in Liu 2024. Pinning keeps the free card light.",
        recipe_sources=[LIU_CHESTNUT],
    ))
    P.append(build(
        "wood-ear-dark", "wood-ear",
        name="Wood Ear: deep black", strain="Black wood ear auricularia",
        tags=["culinary", "chef", "intermediate", "warm", "woodlover"], price=299,
        summary="Bright, blue-heavy light during fruiting for the near-black ears prized in cold salads and hot pots.",
        notes="Color builds over the stage. Ears grown dim come out brown.",
        chamber="Bright LEDs add heat; check that the chamber does not run warm.",
        sources=[CELLS_WOODEAR, AGRI_WOODEAR],
        stages=[
            ("colonization", {}),
            ("pinning", {}),
            ("fruiting", dict(name="Bright fruiting")),
        ],
        phases={"colonization": DARK, "pinning": phase(12, 20, blue=80), "fruiting": phase(12, 65, blue=100)},
        why="65% white is about 2,400 lux plus full blue. Darker ears came with more light in Qiu 2023 and with blue light in the 2026 study. The chamber is far below the top intensity in Qiu 2023, so this is the brightest practical setting, not a match.",
        recipe_sources=[CELLS_WOODEAR, AGRI_WOODEAR],
    ))
    return P


def king_oyster():
    path = OUT / "king-oyster-thick-stem.json"
    d = json.loads(path.read_text())
    d["tags"] = ["culinary", "chef", "intermediate", "oyster"]
    d["summary"] = "Cooler, drier fruiting with controlled fresh air for thick, meaty stems you can slice into scallop-style rounds."
    d["notes"] = "Fewer, larger pins beat a full flush of thin fruits. Pull extra pins early so one or two stems get the food."
    d["source_notes"] = [KOREA_KING] + [s for s in d["source_notes"] if s["title"] == "Stamets"]
    for st in d["stages"]:
        if st["id"] == "fruiting":
            st["fan"] = {"period_min": 20, "run_duration_s": 25, "speed_percent": 30}
    if CHAMBER not in d["chamber_notes"]:
        d["chamber_notes"] = d["chamber_notes"] + " " + CHAMBER
    return d


def main():
    written = []
    for d in profiles() + [king_oyster()]:
        prof = validate_profile(d)
        out = prof.to_dict()
        if out != d:
            raise SystemExit(f"{d['id']}: round trip changed the profile")
        (OUT / f"{d['id']}.json").write_text(json.dumps(out, indent=2) + "\n")
        written.append(d["id"])
    print("\n".join(written))


if __name__ == "__main__":
    main()
