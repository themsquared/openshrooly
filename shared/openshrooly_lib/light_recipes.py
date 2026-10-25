"""Cited per-variety light recipes for built-in profiles.

Numbers come from the sources on each recipe. Where a variety has no
photoperiod or intensity of its own, the recipe uses a labeled general
default. RGB values are a WS2812 mix, not a measured spectrum.
"""

from __future__ import annotations

from .models import LightPhase, LightRecipe, SourceNote, WAVELENGTH_NOTE

# Firmware white channel: 20% is 92 lux (lighting_control_manager.yaml).
# These percents are the inverse of that curve, rounded to whole numbers.
DARK = LightPhase(0, 0, 0, 0, 0)
# Penn State oyster rooms: 50 to 300 lux. 20% white is 92 lux on this strip.
OYSTER_FRUITING = LightPhase(12, 20, 0, 0, 80)
# 500 lux cited for reishi and maitake yield maps to 37% white.
LUX_500 = LightPhase(12, 37, 0, 0, 80)
# Chi 2008: white outyielded blue, so maitake uses white only at that 500 lux.
MAITAKE_FRUITING = LightPhase(12, 37, 0, 0, 0)
# 200 lux maps to 26% white. Jozifek 2025 additional tests used 200 lux on a 12 h cycle.
LUX_200 = LightPhase(12, 26, 0, 0, 80)
# Cordyceps 1250 lux (cordycepin optimum in Wu 2016) maps to 51% white.
CORDYCEPS_FRUITING = LightPhase(12, 51, 0, 0, 80)
# Commercial long-stem enoki: keep light off so caps stay small.
ENOKI_FRUITING = LightPhase(0, 0, 0, 0, 0)
# Button mushroom: light is not required for fruiting.
AGARICUS_FRUITING = LightPhase(0, 0, 0, 0, 0)
# General default when no variety-specific lux exists: same 12 h / 20% / blue mix.
GENERAL_FRUITING = LightPhase(12, 20, 0, 0, 80)


def _src(title: str, detail: str, url: str | None = None) -> SourceNote:
    return SourceNote(title=title, detail=detail, url=url)


def _recipe(
    why: str,
    sources: list[SourceNote],
    fruiting: LightPhase,
    pinning: LightPhase | None = None,
    **extra: LightPhase,
) -> LightRecipe:
    # Pinning uses the fruiting mix unless a paper says otherwise. Light is the
    # usual pinning cue; colonization-like rests stay dark via extra=DARK.
    phases = {
        "colonization": DARK,
        "pinning": fruiting if pinning is None else pinning,
        "fruiting": fruiting,
        **extra,
    }
    return LightRecipe(why=why, sources=sources, phases=phases, wavelength_note=WAVELENGTH_NOTE)


STAMETS_BOOK = _src(
    "Stamets",
    "Paul Stamets, Growing Gourmet and Medicinal Mushrooms, Ten Speed Press. "
    "Used here as a general cultivation reference. This recipe does not take a "
    "photoperiod or lux number from a cited page in that book.",
)
SAKAMOTO_2018 = _src(
    "Sakamoto 2018",
    "Yuichi Sakamoto, Influences of environmental factors on fruiting body induction, "
    "development and maturation in mushroom-forming fungi, Fungal Biology Reviews 32 (2018). "
    "Light is a fruiting cue for many basidiomycetes. Blue light is the usual "
    "photomorphogenesis signal. Agaricus bisporus is called out as not needing light "
    "for a cap. Flammulina velutipes can fruit in the dark as a long stem with a tiny cap.",
    "https://doi.org/10.1016/j.fbr.2018.02.003",
)
PENN_STATE_OYSTER = _src(
    "Penn State oyster production",
    "Daniel J. Royse, Cultivation of Oyster Mushrooms, Penn State College of Agricultural "
    "Sciences. First 12 to 21 days of spawn run may be completed without artificial lighting. "
    "After spawn run, 4 h of cool white fluorescent light at 50 to 300 lux may be provided. "
    "This recipe uses 12 h as a labeled default photoperiod, not a page-cited Stamets value, "
    "and maps 20% white to 92 lux, inside that 50 to 300 lux band.",
    "https://mushroomcompany.com/resources/oyster/paoyster.pdf",
)
RICHARTZ_1987 = _src(
    "Richartz and MacLellan 1987 action spectrum",
    "Gisela Richartz and Andrew J. MacLellan, Action spectra for hyphal aggregation, the "
    "first stage of fruiting, in Pleurotus ostreatus, Photochemistry and Photobiology 45 "
    "(1987). Peaks at 370 nm and 440 to 450 nm. Wavelengths longer than 530 nm gave no "
    "response.",
    "https://doi.org/10.1111/j.1751-1097.1987.tb07888.x",
)
WANG_2020 = _src(
    "Wang 2020 blue versus red",
    "Hao Wang et al., Transcriptomic profiling sheds light on the blue-light and red-light "
    "response of oyster mushroom (Pleurotus ostreatus), AMB Express 10 (2020). Blue LED "
    "430 to 470 nm at about 50 umol/m2/s improved cap growth. Red 610 to 640 nm did not.",
    "https://pmc.ncbi.nlm.nih.gov/articles/PMC6969877/",
)
DE_BONIS_2024 = _src(
    "De Bonis 2024 LED wavelengths",
    "Marina De Bonis et al., Effect of Different LED Light Wavelengths on Production and "
    "Quality of Pleurotus ostreatus, Horticulturae 10 (2024), with Penn State co-authors. "
    "450 nm blue increased cap diameter versus red 610 nm.",
    "https://www.mdpi.com/2311-7524/10/4/349",
)
XIE_2018 = _src(
    "Xie 2018 king oyster",
    "Chunliang Xie et al., Comparative transcriptomics of Pleurotus eryngii reveals "
    "blue-light regulation of carbohydrate-active enzymes (CAZymes) at primordium "
    "differentiated into fruiting body stage, Genomics 110 (2018). Blue light induced "
    "primordium differentiation.",
    "https://doi.org/10.1016/j.ygeno.2017.09.012",
)
LEATHAM_1987 = _src(
    "Leatham and Stahmann 1987",
    "Gary F. Leatham and Mark A. Stahmann, Effect of light and aeration on fruiting of "
    "Lentinula edodes, Trans. Br. Mycol. Soc. 88 (1987). Light is required for normal "
    "fruiting. Blue 400 to 500 nm stimulated fruiting on high-calcium media and "
    "suppressed fruiting on low-calcium media. Only pigmented primordia expanded.",
    "https://doi.org/10.1016/s0007-1536(87)80180-8",
)
KIM_2024_SHIITAKE = _src(
    "Kim 2024 shiitake blue light",
    "Min-Jun Kim et al., Effects of Blue Light on Fruiting Body Production and "
    "Ergothioneine Content During Sawdust Cultivation of Shiitake, Mycobiology (2024). "
    "Blue light was applied during incubation, not during fruiting. Yield and "
    "ergothioneine rose versus white in two cultivars. This recipe does not treat that "
    "as a fruiting-stage blue mix.",
    "https://doi.org/10.1080/12298093.2024.2430052",
)
JOZIFEK_2025 = _src(
    "Jozifek et al. 2025",
    "Miroslav Jozifek et al., Selenium Uptake by Hericium erinaceus Basidiocarps, "
    "Agriculture 15 (2025). The main cultivation used 500 lux for 24 h continuous light "
    "and caused pink stress coloring. Additional tests at 200 lux or lower on a 12 h "
    "cycle produced white basidiocarps. This recipe uses that 200 lux, 12 h schedule. "
    "200 lux maps to 26% white.",
    "https://doi.org/10.3390/agriculture15050460",
)
SAKAMOTO_ENOKI = _src(
    "Sakamoto 2004 enoki",
    "Yuichi Sakamoto, Influence of light on the morphological changes that take place "
    "during the development of the Flammulina velutipes fruit body, Mycoscience 45 (2004). "
    "A temperature drop induces fruiting in the dark. Dark fruits are long, pale, and "
    "pinhead. Light then forms a cap.",
    "https://doi.org/10.1007/s10267-004-0195-7",
)
WU_2016_CORDYCEPS = _src(
    "Wu 2016 Cordyceps militaris",
    "Chiu-Yeh Wu et al., Effects of Illumination Pattern during Cultivation of Fruiting "
    "Body and Bioactive Compound Production by Cordyceps militaris, Int. J. Med. Mushrooms "
    "18 (2016). Colonization in a spawn room without a stated photoperiod. Primordia and "
    "fruiting at 12 h per day. Highest dry yield at 1750 plus or minus 250 lux. Highest "
    "cordycepin at 1250 plus or minus 250 lux. This recipe maps 51% white to about 1250 lux.",
    "https://doi.org/10.1615/intjmedmushrooms.v18.i7.40",
)
LIN_2024 = _src(
    "Lin et al. 2024 Cordyceps LED",
    "Yu-Wen Lin et al., Growth of Cordyceps militaris cultivation and its bioactive "
    "component accumulation as affected by various single-wavelength LED light sources, "
    "International Journal of Food Properties 27 (2024). Single-wavelength LEDs changed "
    "bioactive compound levels. This paper is used only for a blue bias, not for a yield "
    "or lux number.",
    "https://doi.org/10.1080/10942912.2024.2373781",
)
BAARS_2020 = _src(
    "Baars et al. 2020",
    "Johan J. P. Baars et al., Critical Factors Involved in Primordia Building in "
    "Agaricus bisporus: A Review, Molecules 25 (2020). A. bisporus does not require "
    "light to fruit. Triggers are temperature, carbon dioxide, casing, and volatiles.",
    "https://doi.org/10.3390/molecules25132984",
)
PENN_STATE_AGARICUS = _src(
    "Penn State Agaricus",
    "Penn State Extension, Basic Procedures for Agaricus Mushroom Growing. Mushrooms are "
    "usually grown without light. Darkness is not a requirement, and light is not listed "
    "as a fruiting control.",
    "https://extension.psu.edu/basic-procedures-for-agaricus-mushroom-growing/",
)
CHI_2008 = _src(
    "Chi et al. 2008 maitake",
    "Jeong-Hyun Chi et al., Studies on Favorable Light Condition for Artificial "
    "Cultivation of Grifola frondosa, Korean J. Mycology 36 (2008). White light "
    "outyielded blue and green. Primordia formed best at 200 lux. Yield was best at "
    "500 lux. 500 lux maps to 37% white.",
    "https://doi.org/10.4489/kjm.2008.36.1.031",
)
KURAHASHI_2015 = _src(
    "Kurahashi et al. 2015",
    "Atsushi Kurahashi et al., A putative transcription factor Gf.BMR1 in Grifola "
    "frondosa, the homolog of BMR1 in Bipolaris oryzae, was strongly induced by "
    "near-ultraviolet light and blue light, Mycoscience 56 (2015). Fruiting used a "
    "12 h light / 12 h dark cycle under a white fluorescent lamp, then compared 463 nm "
    "blue LED and near-UV. Dark-grown caps stayed pale and antler-like.",
    "https://doi.org/10.1016/j.myc.2014.05.005",
)
REISHI_PHD = _src(
    "Corvinus University reishi thesis",
    "Petra Maszlaver, Cultivation possibilities for production of reishi mushroom "
    "Ganoderma lucidum, Corvinus University of Budapest PhD (2011). Literature table: "
    "200 to 500 lux in early fruiting, 500 to 1000 lux later. 500 lux maps to 37% white.",
    "https://phd.lib.uni-corvinus.hu/319/3/maszlaver_petra_ten.pdf",
)
REISHI_2024 = _src(
    "Agriculture 2024 Ganoderma light",
    "Study on the Effects of Different Light Supply Modes on Ganoderma lucidum, "
    "Agriculture 14 (2024). 12 h / 12 h at 15 umol/m2/s. Red delayed or blocked "
    "differentiation. Green raised fruit weight. Blue is still used here as the general "
    "photomorphogenesis mix; this paper did not give a lux number for our white channel.",
    "https://doi.org/10.3390/agriculture14060835",
)
OSU_REISHI = _src(
    "Oregon State Extension reishi",
    "OSU Extension EM 9364, Reishi Mushroom Growing Guide. Antler versus shelf form is "
    "tied to oxygen, not a lux number. Colonize blocks before opening them to fruiting.",
    "https://extension.oregonstate.edu/catalog/pub/em-9364-nontimber-forest-products-small-woodland-owners-reishi-mushroom-growing-guide",
)
BADHAM_1980 = _src(
    "Badham 1980",
    "Edmond R. Badham, The Effect of Light Upon Basidiocarp Initiation in Psilocybe "
    "cubensis, Mycologia 72 (1980). Initials formed only after light. 370, 440, and 460 nm "
    "were effective. Wavelengths longer than 510 nm were not. The saturating dose is a "
    "flash energy, not a room lux, so intensity here is the general default.",
    "https://doi.org/10.1080/00275514.1980.12021162",
)
WALDBILLIG_2023 = _src(
    "Waldbillig et al. 2023 fruiting protocol",
    "Adam Waldbillig et al., Exploring Psilocybe spp. mycelium and fruiting body chemistry "
    "for potential therapeutic compounds, Frontiers in Fungal Biology 4 (2023). Fruiting "
    "used a 12 h photoperiod at about 6400 K. No lux number.",
    "https://doi.org/10.3389/ffunb.2023.1295223",
)
GENERAL_DEFAULT = _src(
    "General default",
    "No variety-specific photoperiod or lux was found for this species. Colonization is "
    "dark (Sakamoto 2018; Penn State oyster spawn run). Fruiting uses 12 h as a labeled "
    "default, not a page-cited Stamets value, and 20% white, which is 92 lux on this "
    "chamber, inside the Penn State oyster 50 to 300 lux band. Blue 80% approximates the "
    "440 to 470 nm finding. This is a labeled default, not a measured value for this "
    "variety.",
)

OYSTER_WHY = (
    "Colonization stays dark, as in Penn State spawn-run rooms. Fruiting uses 12 h and a "
    "blue-heavy mix because P. ostreatus aggregates and forms caps under 440 to 470 nm light. "
    "White 20% is 92 lux on this strip, inside the Penn State 50 to 300 lux band."
)
GENERAL_WHY = (
    "No variety-specific light numbers were found. Colonization is dark. Fruiting uses the "
    "general default: 12 h, 20% white (92 lux on this chamber), and 80% blue as a WS2812 "
    "stand-in for 440 to 470 nm."
)


def _oyster() -> LightRecipe:
    return _recipe(
        OYSTER_WHY,
        [PENN_STATE_OYSTER, RICHARTZ_1987, WANG_2020, DE_BONIS_2024, STAMETS_BOOK],
        OYSTER_FRUITING,
    )


def _king() -> LightRecipe:
    return _recipe(
        "Same dark spawn run as other oysters. Fruiting is blue-heavy because P. eryngii "
        "primordia respond to blue light. Hours and white percent are the oyster default "
        "(12 h, 20% / 92 lux). No king-oyster-specific lux was found.",
        [XIE_2018, PENN_STATE_OYSTER, STAMETS_BOOK, SAKAMOTO_2018],
        OYSTER_FRUITING,
    )


RECIPES: dict[str, LightRecipe] = {
    "pearl-oyster": _oyster(),
    "blue-oyster": _oyster(),
    "pink-oyster": _recipe(
        "P. djamor has no variety-specific lux in the sources below. The recipe is the "
        "P. ostreatus oyster default (dark colonize, 12 h, 20% white, blue-heavy RGB) "
        "and is labeled as such.",
        [PENN_STATE_OYSTER, RICHARTZ_1987, WANG_2020, STAMETS_BOOK, GENERAL_DEFAULT],
        OYSTER_FRUITING,
    ),
    "golden-oyster": _recipe(
        "P. citrinopileatus has no variety-specific lux in the sources below. The recipe "
        "is the P. ostreatus oyster default and is labeled as such.",
        [PENN_STATE_OYSTER, RICHARTZ_1987, DE_BONIS_2024, STAMETS_BOOK, GENERAL_DEFAULT],
        OYSTER_FRUITING,
    ),
    "king-oyster": _king(),
    "king-oyster-thick-stem": _king(),
    "lions-mane": _recipe(
        "Colonization is dark to limit early pins. Fruiting uses 12 h and 26% white, "
        "mapped from Jozifek et al. 2025 additional tests at 200 lux on a 12 h cycle, "
        "which produced white basidiocarps. Their main 500 lux treatment was 24 h "
        "continuous light and caused pink stress coloring, so that schedule is not used. "
        "RGB is the general blue mix; that paper used white fluorescent, not a measured "
        "blue ratio.",
        [JOZIFEK_2025, SAKAMOTO_2018, STAMETS_BOOK],
        LUX_200,
    ),
    "shiitake": _recipe(
        "Colonization and the browning rest stay dark (mycelium grows faster without "
        "strong light). Fruiting uses 12 h and the general 20% white / blue mix. Leatham "
        "found blue helped only on high-calcium media and suppressed fruiting on "
        "low-calcium media. Kim 2024 applied blue during incubation, not fruiting. No "
        "shiitake-specific fruiting lux for this chamber was found.",
        [LEATHAM_1987, KIM_2024_SHIITAKE, STAMETS_BOOK, SAKAMOTO_2018, GENERAL_DEFAULT],
        GENERAL_FRUITING,
        browning=DARK,
        cold_shock=DARK,
    ),
    "reishi": _recipe(
        "Colonization is dark. Fruiting uses 12 h and 37% white, mapped from 500 lux in "
        "the Corvinus literature table (200 to 500 lux early, 500 to 1000 lux later). "
        "Blue is the general photomorphogenesis mix. A 2024 paper found green raised "
        "weight and red delayed caps; we do not invent a green-heavy mix from that.",
        [REISHI_PHD, REISHI_2024, OSU_REISHI, STAMETS_BOOK],
        LUX_500,
    ),
    "chestnut": _recipe(
        GENERAL_WHY,
        [GENERAL_DEFAULT, SAKAMOTO_2018, STAMETS_BOOK, PENN_STATE_OYSTER],
        GENERAL_FRUITING,
    ),
    "pioppino": _recipe(
        GENERAL_WHY,
        [GENERAL_DEFAULT, SAKAMOTO_2018, STAMETS_BOOK, PENN_STATE_OYSTER],
        GENERAL_FRUITING,
    ),
    "enoki": _recipe(
        "Commercial long-stem enoki is grown with little light. Sakamoto 2004 showed a "
        "cold dark room makes long pale pinhead fruits; light then forms a cap. This "
        "recipe keeps both phases at 0 h so stems stay long. That is a morphology choice "
        "from the paper, not a lux number.",
        [SAKAMOTO_ENOKI, SAKAMOTO_2018, STAMETS_BOOK],
        ENOKI_FRUITING,
    ),
    "maitake": _recipe(
        "Colonization is dark. Fruiting uses 12 h (Kurahashi 2015) and 37% white, mapped "
        "from the 500 lux yield optimum in Chi 2008. That trial found white outyielded "
        "blue and green, so RGB stays off and the white channel carries the light. Blue "
        "is not used because it conflicted with that yield result.",
        [CHI_2008, KURAHASHI_2015, SAKAMOTO_2018],
        MAITAKE_FRUITING,
    ),
    "cordyceps-militaris": _recipe(
        "Colonization stays dark. Fruiting uses 12 h and 51% white, mapped from 1250 lux "
        "(cordycepin optimum in Wu 2016; 1750 lux gave more dry weight). RGB is blue-heavy "
        "from later LED work on compound levels, not from a yield result or a measured "
        "spectrum on this strip.",
        [WU_2016_CORDYCEPS, LIN_2024],
        CORDYCEPS_FRUITING,
    ),
    "wine-cap": _recipe(
        "Wine cap is usually an outdoor bed crop. No indoor lux or photoperiod paper was "
        "found, so this is the labeled general default.",
        [GENERAL_DEFAULT, SAKAMOTO_2018, STAMETS_BOOK],
        GENERAL_FRUITING,
    ),
    "button-cremini": _recipe(
        "A. bisporus does not need light to fruit. Penn State rooms usually run without "
        "it. Both phases stay at 0 h and 0% on this strip.",
        [BAARS_2020, PENN_STATE_AGARICUS, SAKAMOTO_2018],
        AGARICUS_FRUITING,
    ),
    "nameko": _recipe(
        GENERAL_WHY,
        [GENERAL_DEFAULT, SAKAMOTO_2018, STAMETS_BOOK, PENN_STATE_OYSTER],
        GENERAL_FRUITING,
    ),
    "turkey-tail": _recipe(
        "No Trametes-specific lux was found. Hours and intensity are the labeled general "
        "default.",
        [STAMETS_BOOK, SAKAMOTO_2018, GENERAL_DEFAULT],
        GENERAL_FRUITING,
    ),
    "beech-shimeji": _recipe(
        GENERAL_WHY,
        [GENERAL_DEFAULT, SAKAMOTO_2018, STAMETS_BOOK, PENN_STATE_OYSTER],
        GENERAL_FRUITING,
    ),
    "elm-oyster": _recipe(
        "Hypsizygus ulmarius is not a Pleurotus. No variety-specific lux was found, so "
        "this is the labeled general default, not the oyster production numbers.",
        [GENERAL_DEFAULT, SAKAMOTO_2018, STAMETS_BOOK],
        GENERAL_FRUITING,
    ),
    "wood-ear": _recipe(
        GENERAL_WHY,
        [GENERAL_DEFAULT, SAKAMOTO_2018, STAMETS_BOOK],
        GENERAL_FRUITING,
    ),
    "golden-teacher": _recipe(
        "Badham 1980 showed P. cubensis initials need light, with peaks at 370, 440, and "
        "460 nm. Waldbillig 2023 fruited at 12 h. Intensity is the labeled general default "
        "(20% white / 92 lux) because those papers do not give a room lux.",
        [BADHAM_1980, WALDBILLIG_2023, SAKAMOTO_2018, GENERAL_DEFAULT],
        GENERAL_FRUITING,
    ),
    "b-plus": _recipe(
        "Same species as Golden Teacher. No B+-specific light paper was found. Hours and "
        "mix follow Badham 1980 and the 12 h Waldbillig protocol. Intensity is the labeled "
        "general default.",
        [BADHAM_1980, WALDBILLIG_2023, GENERAL_DEFAULT],
        GENERAL_FRUITING,
    ),
    "penis-envy": _recipe(
        "Same species as Golden Teacher. No strain-specific light paper was found. Hours "
        "and mix follow Badham 1980 and the 12 h Waldbillig protocol. Intensity is the "
        "labeled general default.",
        [BADHAM_1980, WALDBILLIG_2023, GENERAL_DEFAULT],
        GENERAL_FRUITING,
    ),
    "p-cyanescens": _recipe(
        "No P. cyanescens photoperiod or lux paper was found. This is the labeled general "
        "default plus the P. cubensis blue-light finding, which is not a cyanescens measurement.",
        [GENERAL_DEFAULT, BADHAM_1980, SAKAMOTO_2018, STAMETS_BOOK],
        GENERAL_FRUITING,
    ),
    "p-natalensis": _recipe(
        "No P. natalensis photoperiod or lux paper was found. This is the labeled general "
        "default plus the P. cubensis blue-light finding, which is not a natalensis measurement.",
        [GENERAL_DEFAULT, BADHAM_1980, WALDBILLIG_2023],
        GENERAL_FRUITING,
    ),
}


def recipe_for(profile_id: str) -> LightRecipe:
    try:
        return RECIPES[profile_id]
    except KeyError as exc:
        raise KeyError(f"no light recipe for {profile_id}") from exc
