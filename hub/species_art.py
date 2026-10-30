"""Original harvest photos for hub cards — not taken from shrooly.com.

Keep the key list aligned with community/web/public/js/species-art.js.
"""

from __future__ import annotations

PHOTOS: list[tuple[tuple[str, ...], str]] = [
    (("pink", "oyster"), "/static/img/species/species-pink-oyster.jpg"),
    (("golden", "oyster"), "/static/img/species/species-golden-oyster.jpg"),
    (("yellow", "oyster"), "/static/img/species/species-golden-oyster.jpg"),
    (("black", "oyster"), "/static/img/species/species-blue-oyster.jpg"),
    (("king", "oyster"), "/static/img/species/species-king-oyster.jpg"),
    (("blue", "oyster"), "/static/img/species/species-blue-oyster.jpg"),
    (("elm", "oyster"), "/static/img/species/species-elm-oyster.jpg"),
    (("ulmarius",), "/static/img/species/species-elm-oyster.jpg"),
    (("beech",), "/static/img/species/species-beech.jpg"),
    (("shimeji",), "/static/img/species/species-beech.jpg"),
    (("tessulatus",), "/static/img/species/species-beech.jpg"),
    (("cremini",), "/static/img/species/species-cremini.jpg"),
    (("button",), "/static/img/species/species-cremini.jpg"),
    (("agaricus",), "/static/img/species/species-cremini.jpg"),
    (("chestnut",), "/static/img/species/species-chestnut.jpg"),
    (("pholiota adiposa",), "/static/img/species/species-chestnut.jpg"),
    (("cordyceps",), "/static/img/species/species-cordyceps.jpg"),
    (("maitake",), "/static/img/species/species-maitake.jpg"),
    (("grifola",), "/static/img/species/species-maitake.jpg"),
    (("turkey",), "/static/img/species/species-turkey-tail.jpg"),
    (("trametes",), "/static/img/species/species-turkey-tail.jpg"),
    (("wine",), "/static/img/species/species-wine-cap.jpg"),
    (("stropharia",), "/static/img/species/species-wine-cap.jpg"),
    (("nameko",), "/static/img/species/species-nameko.jpg"),
    (("pholiota microspora",), "/static/img/species/species-nameko.jpg"),
    (("pioppino",), "/static/img/species/species-pioppino.jpg"),
    (("cyclocybe",), "/static/img/species/species-pioppino.jpg"),
    (("wood ear",), "/static/img/species/species-wood-ear.jpg"),
    (("auricularia",), "/static/img/species/species-wood-ear.jpg"),
    (("lion", "mane"), "/static/img/species/species-lions-mane.jpg"),
    (("hericium",), "/static/img/species/species-lions-mane.jpg"),
    (("shiitake",), "/static/img/species/species-shiitake.jpg"),
    (("lentinula",), "/static/img/species/species-shiitake.jpg"),
    (("reishi",), "/static/img/species/species-reishi.jpg"),
    (("ganoderma",), "/static/img/species/species-reishi.jpg"),
    (("enoki",), "/static/img/species/species-enoki.jpg"),
    (("flammulina",), "/static/img/species/species-enoki.jpg"),
    (("oyster",), "/static/img/species/species-oyster.jpg"),
    (("pleurotus",), "/static/img/species/species-oyster.jpg"),
]

FALLBACK = "/static/img/species/species-generic.jpg"


def species_photo(species: str = "", strain: str = "", name: str = "") -> str:
    blob = f"{species} {strain} {name}".lower()
    for keys, src in PHOTOS:
        if all(key in blob for key in keys):
            return src
    return FALLBACK
