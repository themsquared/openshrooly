---
title: Martha tent setup for mushrooms: humidity, fresh air and light
h1: How do you set up a martha tent for mushrooms?
description: Size the fan for 4 to 6 air changes an hour, put the humidifier low and the sensor mid height, run light 12 h on a timer, and group species by target.
date: 2026-11-13
updated: 2026-11-13
category: Chamber builds
answer: A martha tent is a wire shelf in a clear zip up cover with three add ons: an ultrasonic humidifier on the bottom shelf, a fan on a timer, and a light on a timer. Aim the mist into open space, never at a block, and put the humidity sensor at mid height out of the mist. Size the fan for 4 to 6 fresh air changes an hour while oysters fruit, the University of California number. For a 70 x 50 x 160 cm tent (560 L) that averages 37 to 56 L of air a minute, about 1.3 to 2 CFM, so a fan that really moves 20 CFM only needs 40 seconds every 10 minutes, which is the fan cycle in our pearl oyster profile. Run light 12 hours a day at 50 to 300 lux. Then fill the tent with species that want the same numbers: our oyster profiles fruit at 86 to 88% humidity, lion's mane at 90% and 17 °C, chestnut and nameko at 92 to 93%, and pink and golden oyster fruit at 21 to 24 °C while the rest fruit at 14 to 17 °C.
species: pearl-oyster, blue-oyster, golden-oyster, pink-oyster, king-oyster, lions-mane, chestnut, pioppino, shiitake, nameko, beech-shimeji
related:
  - Fresh air calculator | /tools/fresh-air-planner
  - Humidity and fresh air | /guides/humidity-and-fresh-air
  - Do mushrooms need light? | /blog/do-mushrooms-need-light
  - Grow kit vs monotub vs smart chamber | /guides/grow-kit-vs-monotub-vs-smart-chamber
  - Build a fruiting chamber with an ESP32 | /blog/esp32-esphome-mushroom-fruiting-chamber
  - Long, leggy mushroom stems | /guides/leggy-mushroom-stems
howto: How to set up a martha tent, step by step
---

## What is a martha tent, and when is it worth building?

A martha tent is a small greenhouse shelf, usually four or five wire shelves inside a clear plastic cover with a zip front, turned into a fruiting chamber. The name stuck from the first builds on a store bought portable closet, and now it means any shelf in a clear cover. On its own it is just a humid box. It becomes a fruiting chamber when you add a humidifier, a fan and a light, and put the humidifier and fan on controllers so they run without you.

It fits between a single grow kit and a countertop smart chamber. Our [grow kit vs monotub vs smart chamber](/guides/grow-kit-vs-monotub-vs-smart-chamber) guide puts the shelf tent in the "biggest harvest for the money" group, with uneven conditions between shelves as the main thing that goes wrong. Build one when one block at a time feels too small and you have floor space near an outlet, ideally near a window or vent you can exhaust to.

The hard part is not the shelf. It is getting humidity, fresh air and light right at the same time, in a box that is far bigger than a kit and far leakier than a sealed chamber. The rest of this post gives you numbers for each one.

## What size martha tent do you need, and how do you work out its volume?

Measure the inside of your cover, not the box it came in. Volume decides how big the humidifier has to be and how much fan you need.

Volume in liters is length x width x height in centimeters, divided by 1,000. For a worked example, take a tent measuring 70 x 50 x 160 cm inside:

- 70 x 50 x 160 = 560,000 cubic centimeters, which is **560 L**, or about 19.8 cubic feet.
- That is more than fifteen times the 36 L chamber in the worked example on our [fresh air calculator](/tools/fresh-air-planner).

Plan the shelf load with air in mind. Leave a hand's width between blocks and between blocks and the cover so the fan's air and the mist can reach every side. Oysters fruit out of the holes in the bag, so face the holes toward open space, not toward the cover or the next bag.

## Where should the humidifier go in a martha tent?

Put an ultrasonic humidifier on the bottom of the tent and aim the mist up into the open middle of the tent, not at a block. A SARE funded oyster guide says the hard part of humidifying is getting the air wet without spraying the mushrooms, because mushrooms soak up any water that lands on them and go soggy ([SARE and FungiAlly](https://projects.sare.org/media/pdf/F/u/n/FungiAlly_Oyster_booklet_Final-1.pdf)). Mist that lands as drops is a problem; mist that hangs in the air is the goal.

Rules that keep it working:

- **Leave the bottom shelf empty, or use it only for blocks well out of the mist path.** The block nearest the outlet will get wet first.
- **Keep the humidifier out of standing water.** Set the tent on a tray to catch condensation, and set the humidifier up on something so it does not sit in the puddle it makes.
- **Use distilled water.** The EPA says ultrasonic humidifiers are very efficient at putting tap water minerals into the air as white dust, and that mineral scale in the tank can be a breeding ground for microorganisms. Distilled water has the least mineral content ([EPA](https://www.epa.gov/indoor-air-quality-iaq/use-and-care-home-humidifiers)). In a closed tent, that dust lands on your mushrooms.
- **Clean it on a schedule.** The EPA says to empty and refill a portable humidifier daily and scrub it every third day. The CPSC warns that bacteria and fungi grow in dirty humidifier tanks and come out in the mist ([CPSC](https://www.cpsc.gov/s3fs-public/5046.pdf)). A tent is a warm, wet place, so a dirty tank seeds the same air your blocks are breathing.
- **Plug it into a GFCI outlet.** Water, mist and power cords share a small space. The CPSC says a GFCI shuts off power when as little as 0.006 amps leaks to ground, and recommends GFCI protection where electrical equipment is near water ([CPSC](https://www.cpsc.gov/s3fs-public/099_0.pdf)). If the outlet is not a GFCI, a plug in GFCI adapter does the job.

## How do you size a humidifier for a martha tent?

There is no reliable liters per hour rule, because how fast a tent loses moisture depends on how leaky the cover is, how dry the room is and how much fan you run. Test it instead, with the tent empty:

1. Set the fan cycle you plan to use (next section).
2. Turn the humidifier on through its controller with the target you plan to fruit at.
3. Watch the reading through a few fan cycles.

A humidifier that is big enough pulls the tent back to target well before the next fan run starts. One that never reaches the target, or only gets there with the fan off, is too small or the cover leaks too much. One that overshoots far past the target before it shuts off is too strong for the space, or is too close to the sensor.

## What humidity should a martha tent run at?

Set it to the species, not to a general number. A University of California grower guide gives 95% for oyster pinhead initiation and 85 to 92% while they crop ([UC ANR](https://ucanr.edu/sites/default/files/2012-05/144772.pdf)). The SARE guide gives 80 to 90%, close to 90% to start pins ([SARE and FungiAlly](https://projects.sare.org/media/pdf/F/u/n/FungiAlly_Oyster_booklet_Final-1.pdf)). Our profiles sit inside those ranges and step down from pinning to fruiting, the way our [humidity and fresh air guide](/guides/humidity-and-fresh-air) explains.

The bigger mistake in tents is the control band, not the target. A wide band, such as on at 80% and off at 90%, makes the tent swing ten points every cycle. Our own firmware turns the humidifier on 1.5 points under target and off 0.5 points over, with at least 90 seconds on and 60 seconds off so it does not chatter ([OpenShrooly controls.yaml](https://github.com/themsquared/openshrooly/blob/main/esphome/components/controls.yaml)). Copy that idea on whatever controller you use: the narrowest band it allows, with a minimum on and off time if it has one.

### Where should the humidity sensor go?

At mid height, near the blocks, out of the mist stream. A sensor in the plume reads near 100% and shuts the humidifier off while the top shelf dries out. A sensor on the top shelf against a warm ceiling reads lower than the blocks feel.

Check the sensor before you trust it. Seal it in a jar with a damp paste of table salt and water for 8 to 12 hours at steady room temperature. Saturated salt holds the air at about 75% at 25 °C ([Greenspan, NIST](https://nvlpubs.nist.gov/nistpubs/jres/81A/jresv81An1p89_A1b.pdf)). If your sensor reads 70% or 80% in that jar, it is 5 points off, and so is your tent. The [humidity and fresh air guide](/guides/humidity-and-fresh-air) has the full method.

If you can, put a second sensor on the top shelf for the first grow. The top and bottom of a tent rarely match, and the gap tells you whether to move blocks or move the sensor.

## How much fresh air does a martha tent need?

Size the fan with air changes per hour. One air change moves as much air as the tent holds. The University of California guide lists 4 fresh air changes an hour while oyster pins form and 4 to 6 an hour while they crop, with carbon dioxide under 600 ppm, and none during spawn run ([UC ANR](https://ucanr.edu/sites/default/files/2012-05/144772.pdf)). The SARE guide says to keep carbon dioxide under 800 ppm, to change all the air in a fruiting room at least every 10 minutes, which is 6 changes an hour, and that above 1,200 ppm fruiting can be inhibited ([SARE and FungiAlly](https://projects.sare.org/media/pdf/F/u/n/FungiAlly_Oyster_booklet_Final-1.pdf)).

For the 560 L example tent:

| Target | Air per hour | Average flow | Average flow in CFM |
| --- | --- | --- | --- |
| 4 air changes an hour | 2,240 L | 37 L per minute | 1.3 CFM |
| 6 air changes an hour | 3,360 L | 56 L per minute | 2.0 CFM |

That average is tiny. A small fan running nonstop would blow the humidity out of the tent, which is why you run it in short bursts on a timer. The math is the same one the [fresh air calculator](/tools/fresh-air-planner) uses: air changes per hour equals fan flow per hour times the share of each cycle the fan is on, divided by the tent volume. Enter your tent size and your fan's flow there, pick the species, and it fills in the profile's fan cycle and shows the air changes you get.

### What fan cycle should you use for each species?

Here is what each profile's fruiting fan cycle gives in the 560 L tent if your fan really moves 20 CFM (566 L per minute) at full speed. Use full speed in a tent. The fan speed percent in a profile is for a small chamber fan.

| Mushroom | Fruiting fan cycle in the profile | Fan on | Air changes an hour in a 560 L tent at 20 CFM |
| --- | --- | --- | --- |
| [Pearl oyster](/profiles/pearl-oyster), [blue oyster](/profiles/blue-oyster), [golden oyster](/profiles/golden-oyster), [pink oyster](/profiles/pink-oyster) | 40 s every 10 min | 6.7% | 4.0 |
| [Shiitake](/profiles/shiitake) | 35 s every 12 min | 4.9% | 2.9 |
| [Chestnut](/profiles/chestnut), [pioppino](/profiles/pioppino) | 30 s every 15 min | 3.3% | 2.0 |
| [Lion's mane](/profiles/lions-mane), [nameko](/profiles/nameko), [beech](/profiles/beech-shimeji) | 25 s every 18 min | 2.3% | 1.4 |
| [King oyster](/profiles/king-oyster) | 25 s every 25 min | 1.7% | 1.0 |

So the oyster profile cycle lands right on the low end of the University of California number, and the slower species get less air, which is what their profiles ask for. If your fan moves more or less than 20 CFM, scale the run time by the same ratio. A 40 CFM fan needs half the seconds.

Two cautions. A fan rarely moves its rated flow once it pushes through a filter or a small hole, so measured flow is usually lower than the label. And a full tent holds a lot of substrate in little air. The University of California and SARE numbers are for grow rooms full of blocks, and a packed martha tent is closer to that than a one block chamber is. Start at the profile cycle and let the mushrooms correct you: long stems and small caps mean more air, as our [leggy stems guide](/guides/leggy-mushroom-stems) covers, and dry or cracked caps mean more humidity.

### Where should the fan go?

Mount the fan through the cover low on one side and leave a filtered exhaust opening high on the opposite side, so each burst sweeps across the shelves. Do not point it straight at a block. Short, frequent bursts beat long, rare ones: every burst pulls humidity down, because room air is drier than fruiting air, and short bursts give the humidifier time to recover, as the [fresh air calculator](/tools/fresh-air-planner) explains.

### Why exhaust a martha tent outside the room?

Spores. The SARE guide says oyster mushrooms are known for their heavy spore load and calls for routine cleaning and a mask in the fruiting room ([SARE and FungiAlly](https://projects.sare.org/media/pdf/F/u/n/FungiAlly_Oyster_booklet_Final-1.pdf)). Oyster spores have caused allergic lung inflammation in mushroom workers, and one clinical report found that growing oysters as a hobby was enough to cause the sensitivity ([European Respiratory Journal 1993](https://doi.org/10.1183/09031936.93.01050466); [Occupational Medicine 1998](https://doi.org/10.1093/occmed/48.7.465)). A tent full of fruiting oysters in a bedroom puts those spores into the room you sleep in. Duct the exhaust out a window or into a space nobody sleeps in, wear a mask when you open the tent to harvest, and harvest oysters while the cap edges still roll under, which the SARE guide says also limits how many spores they release.

## How much light does a martha tent need, and for how long?

Not much, but on a schedule. Penn State's oyster production guide gives 50 to 300 lux of cool white light after spawn run ([Royse, Penn State](https://mushroomcompany.com/resources/oyster/paoyster.pdf)). Most of our profiles run 12 hours a day at about 92 lux, starting at 8:00. [Lion's mane](/profiles/lions-mane) runs 190 lux. Bright light is not better: our [do mushrooms need light](/blog/do-mushrooms-need-light) post covers why indirect light is fine and direct sun is not, since it heats and dries the block, and which species want something different.

Martha specific details:

- **Wire shelves shade each other.** A light on top lights the top shelf and leaves the bottom in shadow. Run a strip down the inside front or both sides of the tent so every shelf sees some light.
- **Use a plug in timer.** Set 12 hours on, 12 off, so the schedule does not depend on you or the room lights.
- **Keep it cool.** A low output LED strip is plenty. A hot lamp warms the top of the tent and dries it.
- **Keep colonizing blocks out.** Our profiles keep colonization dark, and the University of California guide lists total darkness for oyster spawn run ([UC ANR](https://ucanr.edu/sites/default/files/2012-05/144772.pdf)). Finish colonizing in a dark spot, then move blocks into the tent.

## Which mushrooms can share one martha tent?

One tent has one humidity target, one fan timer and one room temperature, so fill it with species that want the same numbers. A martha tent has no heating or cooling, so the room sets the temperature. These are the fruiting numbers from our profiles:

| Mushroom | Pinning | Fruiting humidity | Fruiting temperature | Light |
| --- | --- | --- | --- | --- |
| [Blue oyster](/profiles/blue-oyster) | 94%, 15 °C | 87% | 14 °C (57 °F) | 12 h, 92 lux |
| [Pearl oyster](/profiles/pearl-oyster) | 93%, 18 °C | 88% | 16 °C (61 °F) | 12 h, 92 lux |
| [King oyster](/profiles/king-oyster) | 90%, 16 °C | 82% | 15 °C (59 °F) | 12 h, 92 lux |
| [Lion's mane](/profiles/lions-mane) | 94%, 18 °C | 90% | 17 °C (63 °F) | 12 h, 190 lux |
| [Beech](/profiles/beech-shimeji) | 94%, 16 °C | 90% | 15 °C (59 °F) | 12 h, 92 lux |
| [Pioppino](/profiles/pioppino) | 92%, 17 °C | 86% | 16 °C (61 °F) | 12 h, 92 lux |
| [Shiitake](/profiles/shiitake) | Fruits in one stage | 85% | 16 °C (61 °F) | 12 h, 92 lux |
| [Chestnut](/profiles/chestnut) | 95%, 16 °C | 92% | 15 °C (59 °F) | 12 h, 92 lux |
| [Nameko](/profiles/nameko) | 95%, 15 °C | 93% | 14 °C (57 °F) | 12 h, 92 lux |
| [Golden oyster](/profiles/golden-oyster) | 93%, 22 °C | 87% | 21 °C (70 °F) | 12 h, 92 lux |
| [Pink oyster](/profiles/pink-oyster) | 92%, 24 °C | 86% | 24 °C (75 °F) | 12 h, 92 lux |

Groupings that work from that table:

- **Cool room oysters:** pearl and blue oyster together, at about 87 to 88% and 14 to 16 °C, on the 40 seconds every 10 minutes fan cycle. Pioppino and shiitake sit close on humidity and temperature and get by on the same tent with a little more air than they need.
- **Damp and gentle:** lion's mane and beech at 90% and 15 to 17 °C, on 25 seconds every 18 minutes. Chestnut and nameko want 92 to 93%, so add them only if your tent holds the higher number.
- **Warm room:** golden and pink oyster at 86 to 87% and 21 to 24 °C. Put this tent in a warm room. In a 15 °C garage in November, pink oyster is the wrong pick.
- **On its own:** king oyster fruits at 82%, the driest of the group, and wants the least air. In a shared tent it sits in wetter air than its profile asks for, so give it its own tent or a spot farthest from the humidifier.

If you mix, set the tent to the species with the least room for error. Our lion's mane profile says to cut fresh air and raise humidity if the spines yellow or brown, and oysters go leggy without air. A mixed tent of lion's mane and pearl oyster means running the oyster fan cycle and keeping humidity at the lion's mane number, then watching both.

## How to set up a martha tent, step by step

1. Assemble the shelf and cover on a tray in a room near the fruiting temperature of the species you plan to grow, close to a GFCI outlet and a window or vent for exhaust.
2. Measure the inside and work out the volume in liters: length x width x height in cm, divided by 1,000.
3. Cut a fan hole low on one side and a filtered exhaust hole high on the other side.
4. Put the ultrasonic humidifier on the bottom, raised out of standing water, with the mist aimed into the open middle of the tent. Fill it with distilled water.
5. Put the humidity sensor at mid height, near where the blocks will sit, out of the mist stream. Check it in a salt jar first.
6. Plug the humidifier into a humidity controller set to the profile's target with the narrowest band it allows.
7. Enter your tent size and fan flow in the [fresh air calculator](/tools/fresh-air-planner), pick the species, and set the fan timer to the cycle it shows.
8. Mount a low output LED strip down the front or sides and put it on a timer for 12 hours a day.
9. Run the tent empty for a day and watch humidity through several fan cycles. Fix the humidifier size or the band before any blocks go in.
10. Move fully colonized blocks in with space between them and holes facing open air. Change humidity and fan from the pinning to the fruiting numbers on the day the profile says.

## What goes wrong with a martha tent?

- **Water pooling on caps, yellow or slimy spots:** too much mist landing on the mushrooms or too little air moving. Aim the humidifier away and add air before you lower humidity, the order our [humidity and fresh air guide](/guides/humidity-and-fresh-air) recommends.
- **Dry, cracked caps on the top shelf:** the top of the tent is drier than the sensor. Move the sensor up or the blocks down, or add a second sensor.
- **Long stems, small caps, coral shaped oysters:** too little fresh air. Lengthen the fan run.
- **Humidity crashes after every fan run and never recovers:** humidifier too small, cover too leaky, or fan bursts too long. Shorter, more frequent bursts move the same air with smaller drops.
- **White dust on everything:** tap water in an ultrasonic humidifier. Switch to distilled.
- **Musty smell or slime in the humidifier tank:** clean it every third day and change the water daily.

If you would rather not tune a humidifier and timer by hand, a small automated chamber does the same job for one or two blocks. Our [ESP32 fruiting chamber build](/blog/esp32-esphome-mushroom-fruiting-chamber) uses the same control logic and runs a profile by stage.

## FAQ

### How many air changes does a martha tent need?

For oysters, 4 to 6 fresh air changes an hour while fruiting, the University of California number. In a 560 L tent that is 37 to 56 L of air a minute on average. A fan that really moves 20 CFM running 40 seconds every 10 minutes gives about 4.

### Where do you put the humidifier in a martha tent?

On the bottom, raised out of standing water, with the mist aimed into the open middle of the tent and not at any block. Put the humidity sensor at mid height, out of the mist stream.

### What humidity should a martha tent be?

It depends on the species. Our oyster profiles fruit at 86 to 88%, lion's mane and beech at 90%, chestnut and nameko at 92 to 93%, and king oyster at 82%. Pinning runs a few points higher.

### Can you use tap water in a martha tent humidifier?

You can, but the EPA says ultrasonic humidifiers spread tap water minerals as white dust and that mineral scale can grow microorganisms. Distilled water avoids both.

### Does a martha tent need a light?

It needs some light on a regular schedule. Penn State gives 50 to 300 lux for oysters, and our profiles run 12 hours a day at about 92 lux for most species. A low output LED strip on a timer is enough.

### Is a martha tent a greenhouse fruiting chamber?

Yes. It is a small indoor greenhouse shelf with a humidifier, fan and light added. The same setup steps apply to any shelf in a clear cover.

## Sources

- [UC Agriculture and Natural Resources, Cultivating Mushrooms on Small Family Farms](https://ucanr.edu/sites/default/files/2012-05/144772.pdf), for 4 fresh air changes an hour while oyster pins form, 4 to 6 while they crop, carbon dioxide under 600 ppm, no fresh air and total darkness during spawn run, 95% for pinhead initiation and 85 to 92% while cropping
- [SARE and FungiAlly, Growing Oyster Mushrooms](https://projects.sare.org/media/pdf/F/u/n/FungiAlly_Oyster_booklet_Final-1.pdf), for humidifying without spraying mushrooms, 80 to 90% humidity and close to 90% for pins, carbon dioxide under 800 ppm, all the air changed at least every 10 minutes, inhibited fruiting above 1,200 ppm, the heavy oyster spore load with a mask in the fruiting room, and a rolled cap edge limiting spore release
- [Royse, Cultivation of Oyster Mushrooms, Penn State College of Agricultural Sciences](https://mushroomcompany.com/resources/oyster/paoyster.pdf), for 50 to 300 lux of cool white light after spawn run
- [US EPA, Use and Care of Home Humidifiers](https://www.epa.gov/indoor-air-quality-iaq/use-and-care-home-humidifiers), for ultrasonic humidifiers spreading tap water minerals, scale as a breeding ground for microorganisms, distilled water, daily refills and cleaning every third day
- [US CPSC, Dirty Humidifiers May Cause Health Problems, Publication 5046](https://www.cpsc.gov/s3fs-public/5046.pdf), for bacteria and fungi in humidifier tanks released in the mist
- [US CPSC, GFCI Fact Sheet](https://www.cpsc.gov/s3fs-public/099_0.pdf), for GFCI protection near water and the 0.006 amp trip level
- [Greenspan 1977, Humidity Fixed Points of Binary Saturated Aqueous Solutions, Journal of Research of the NBS 81A (NIST)](https://nvlpubs.nist.gov/nistpubs/jres/81A/jresv81An1p89_A1b.pdf), for saturated salt at about 75% at 25 °C
- [Extrinsic allergic alveolitis caused by spores of the oyster mushroom Pleurotus ostreatus, European Respiratory Journal 1993](https://doi.org/10.1183/09031936.93.01050466), for allergic lung inflammation from oyster spores and hobby growing being enough to sensitize
- [Mushroom worker's lung resulting from indoor cultivation of Pleurotus ostreatus, Occupational Medicine 48 (1998)](https://doi.org/10.1093/occmed/48.7.465), for an outbreak in indoor oyster growers
- [OpenShrooly firmware, controls.yaml](https://github.com/themsquared/openshrooly/blob/main/esphome/components/controls.yaml), for the humidifier turning on 1.5 points under target and off 0.5 over, with 90 seconds minimum on and 60 seconds minimum off
- Our [fresh air calculator](/tools/fresh-air-planner), for the air change formula, the 36 L example chamber and short fan bursts letting humidity recover
- Our [humidity and fresh air guide](/guides/humidity-and-fresh-air), for the 8 to 12 hour salt jar check and adding air before lowering humidity
- Our grow profiles for [pearl oyster](/profiles/pearl-oyster), [blue oyster](/profiles/blue-oyster), [golden oyster](/profiles/golden-oyster), [pink oyster](/profiles/pink-oyster), [king oyster](/profiles/king-oyster), [lion's mane](/profiles/lions-mane), [beech](/profiles/beech-shimeji), [pioppino](/profiles/pioppino), [shiitake](/profiles/shiitake), [chestnut](/profiles/chestnut) and [nameko](/profiles/nameko), for every pinning and fruiting humidity, temperature, light and fan cycle in the tables, the 8:00 light start, dark colonization and the lion's mane note on yellow or brown spines
- The 560 L, 2,240 L, 3,360 L, 37 and 56 L per minute, 1.3 and 2.0 CFM, fan on percentages and air changes in this post are our arithmetic from the formula above, with 1 CFM = 28.3 L per minute
