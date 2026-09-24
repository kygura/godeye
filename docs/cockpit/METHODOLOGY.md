# City Intel methodology

> Indicative, built from public statistics; mostly country-level; not relocation advice.

This page explains how City Intel turns public data into the scores and rankings shown
in the cockpit. It is written for users who want to know what a number means and for
reviewers who want to check the method. The implementation is
`src/layers/cityIntel/scoring.js`; its tests are next to it.

## Pillars and metrics

The composite score has four pillars. Each pillar is built from the metrics below.

| Pillar          | Metric                                      | Level   | Better when | Source                                          |
| --------------- | ------------------------------------------- | ------- | ----------- | ----------------------------------------------- |
| Quality of life | Life expectancy at birth                    | country | higher      | World Bank WDI `SP.DYN.LE00.IN`                 |
| Quality of life | Internet users, % of population             | country | higher      | World Bank WDI `IT.NET.USER.ZS`                 |
| Quality of life | Mean annual PM2.5 exposure                  | country | lower       | World Bank WDI `EN.ATM.PM25.MC.M3`              |
| Cost            | Price level relative to the US (derived)    | country | lower       | World Bank WDI `PA.NUS.PRVT.PP` ÷ `PA.NUS.FCRF` |
| Safety          | Intentional homicides per 100k              | country | lower       | World Bank WDI `VC.IHR.PSRC.P5`                 |
| Safety          | Political stability and absence of violence | country | higher      | World Bank WGI `GOV_WGI_PV.EST`                 |
| Travel ease     | Airport access (derived)                    | city    | higher      | OurAirports                                     |
| Travel ease     | Visa access for your passport (derived)     | country | higher      | passport-index-dataset (live)                   |

World Bank data is CC BY 4.0, OurAirports is public domain. The visa data is fetched at
runtime and never bundled, because its upstream terms are unclear. "Derived" means the
value is computed from source data rather than published as-is; the scorecard says so.

### Airport access

Each city records its nearest airport with scheduled passenger service, but only large
or medium airports within 100 km count. OurAirports has no passenger numbers, so this
measures airport type and distance, not hub size.

```
access = type factor × max(0, 1 − km / 100) × 100      (rounded to 0.1)
type factor: large = 1, medium = 0.5
```

A large airport 10 km away scores 90; a medium airport 50 km away scores 25.

A city with **no** qualifying airport within 100 km scores 0. That is a fact the pack
builder checked against the full OurAirports list, not a gap in the data, so it counts
as the lowest access rather than as missing. Only a city whose airport field was never
filled in (or holds an unknown airport type) is treated as missing.

### Visa access

Visa access only counts once you set a home passport. Until then the metric reads "set
your passport" and the Travel pillar uses airport access alone (coverage: partial). We
never guess a visa requirement.

| Requirement for your passport  | Access level |
| ------------------------------ | ------------ |
| Your own country               | 5            |
| Visa-free (any number of days) | 4            |
| eTA, visa on arrival           | 3            |
| e-visa                         | 2            |
| Visa required                  | 1            |
| No admission                   | 0            |

An eTA and a visa on arrival share a level: both are light-touch, and neither is clearly
easier in general. Unrecognised values count as missing for that destination.

## Normalisation

Metrics use different units, so each one is converted to a 0 to 100 score by
**percentile rank**:

- The best value gets 100 and the worst gets 0. "Best" follows the metric's direction,
  so for PM2.5 or homicides the lowest value gets 100.
- Tied values share the average of their ranks. With values 1, 2, 2, 3, 5 (higher is
  better) the scores are 0, 37.5, 37.5, 75 and 100.
- A metric with a single value gets 50.
- **Country-level metrics are ranked once across countries** that have the metric, and
  that score is then copied to every city in the country. A country with 60 cities in the
  pack counts once, exactly like a country with one city.
- **City-level metrics** (airport access) are ranked across cities.
- Visa access is ranked across the countries that have a known requirement for your
  passport, and is re-ranked when you change passport.

Raw values are always shown next to their percentile, with unit, year, source and level.

### Staleness

A value older than the pack's build year minus 10 years is treated as unavailable, even
if it is present in the data. It is not used for ranking and the scorecard marks it as
stale. Values with no year are treated as missing.

## Pillar scores and coverage

A pillar score is the plain mean of its available metric percentiles. Each pillar has a
coverage label:

- **full**: every metric in the pillar is available;
- **partial**: some are available;
- **unavailable**: none are, and the pillar has no score.

## Composite score and weights

You set four weights, one per pillar. They must be zero or positive. If all four are
zero, all pillars are weighted equally.

The composite is the weighted mean of the **available** pillars only. The weights of the
available pillars are rescaled to sum to one, so a missing pillar is neither counted as
zero nor filled in. If none of the available pillars has any weight (for example, only
Travel is weighted and Travel is unavailable), the city has no composite.

Every composite comes with a coverage summary such as "3 of 4 pillars · 1 city-level
metric".

## Ranking eligibility

Missing data is not random. Homicide statistics are most often missing in unstable
countries, so rescaling weights around the gap would reward the missing data. A city is
therefore ranked only when:

1. the Safety pillar is available, **and**
2. at least 3 of the 4 pillars are available.

Other cities are still shown on the globe in a neutral "insufficient data" style and have
a scorecard, with the reason: `safety-unavailable` or `insufficient-pillars`.

## Ranking order and filters

Most metrics are national, so cities in one country score almost the same. The ranking
therefore groups cities by country by default: countries are ordered by their best city,
and cities within a country follow the same order as the flat list. A toggle switches to
a flat city list.

Ties are broken by composite (highest first), then population (largest first), then city
id. Filters: continent, minimum population, minimum number of available pillars, and
"hide advisory Level N and above". When advisories are offline, that filter hides
nothing; the panel says the advisory data is unavailable.

## Shown, but not scored

- **Climate comfort** covers only about 120 cities. Adding it to Quality of life would
  score those cities on a different basis from the rest. It appears in the scorecard and
  in Trips seasonality.
- **Live air quality** is a current reading, not a long-run average. Scorecard only.
- **Zillow rent** covers US metros only and cannot share a scale with country price
  levels. Scorecard and comparison only.
- **US State Dept advisory level** is a badge and a filter. It largely restates the
  homicide and stability data, it has only 4 levels (so it ties heavily), and US cities
  have no US advisory.
- **GDP per capita** is left out. It measures wealth rather than quality of life and
  moves closely with the price level, so it would count wealth twice.

## Known biases and limits

- **Country-level dominance.** Six of the eight metrics are national, so a small town and
  a capital in the same country look alike. Only airport access tells them apart today.
  Country grouping keeps this visible instead of listing 40 near-identical cities.
- **Missing not at random.** Handled by the eligibility rule above, at the cost of
  dropping some cities from the ranking.
- **Percentiles hide distances.** A rank says who is ahead, not by how much. Check the
  raw values before drawing conclusions.
- **Averages hide inequality.** National figures say nothing about neighbourhoods, or
  about how safe or affordable a city is for a particular person.
- **Source lag.** World Bank indicators often trail by one to three years; the year of
  every value is shown.

## Reproducibility

Scoring is a pure function of the bundled pack, your weights and the optional visa data.
The same inputs always give the same scores and the same order, whatever order the
cities arrive in.
