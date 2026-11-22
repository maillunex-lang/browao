import { readFile, writeFile } from 'node:fs/promises'
import { geoArea, geoMercator, geoNaturalEarth1, geoPath } from 'd3-geo'

const source = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/'
const points = JSON.parse(await readFile(new URL('../src/atlas-points.json', import.meta.url), 'utf8'))

async function land(scale) {
  const response = await fetch(source + `ne_${scale}m_land.geojson`)
  if (!response.ok) throw new Error(`Natural Earth ${scale}m: HTTP ${response.status}`)
  const data = await response.json()
  const landFraction = geoArea(data) / (4 * Math.PI)
  if (landFraction < 0.25 || landFraction > 0.35) {
    throw new Error(`Unexpected Natural Earth land coverage: ${landFraction}`)
  }
  return data
}

const worldWidth = 760
const worldHeight = 400
const regionWidth = 760
const regionHeight = 328
const world = geoNaturalEarth1().fitExtent([[8, 8], [worldWidth - 8, worldHeight - 8]], { type: 'Sphere' })
const region = geoMercator()
  .fitExtent([[34, 46], [regionWidth - 34, regionHeight - 46]], {
    type: 'MultiPoint', coordinates: [[12.1, 45.33], [14.05, 45.86]],
  })
  .clipExtent([[0, 0], [regionWidth, regionHeight]])

function project(data, projection, width, height, locations) {
  const path = geoPath(projection).digits(1)
  return {
    width,
    height,
    land: path(data),
    markers: Object.fromEntries(locations.map(({ id, coordinates }) => [
      id, projection(coordinates).map(value => Number(value.toFixed(1))),
    ])),
  }
}

const [worldLand, regionalLand] = await Promise.all([land(110), land(10)])
const atlas = {
  world: project(worldLand, world, worldWidth, worldHeight, points.continents),
  region: project(regionalLand, region, regionWidth, regionHeight, points.places),
}
await writeFile(new URL('../src/atlas-geometry.json', import.meta.url), JSON.stringify(atlas) + '\n')
