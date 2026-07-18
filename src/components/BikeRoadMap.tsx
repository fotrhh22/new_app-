import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import type { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson'
import { Bike, ChevronDown, Layers3, LoaderCircle, MapPin, Navigation } from 'lucide-react'
import proj4 from 'proj4'
import 'leaflet/dist/leaflet.css'

const WGS84 = 'EPSG:4326'
const EPSG5174 = '+proj=tmerc +lat_0=38 +lon_0=127.002890277778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=-114.61998514,475.96296987,675.01832869,1.162,-2.347,-1.592,6.342 +units=m +no_defs'

const DISTRICTS: Record<string, string> = {
  '11010': '종로구', '11020': '중구', '11030': '용산구', '11040': '성동구', '11050': '광진구',
  '11060': '동대문구', '11070': '중랑구', '11080': '성북구', '11090': '강북구', '11100': '도봉구',
  '11110': '노원구', '11120': '은평구', '11130': '서대문구', '11140': '마포구', '11150': '양천구',
  '11160': '강서구', '11170': '구로구', '11180': '금천구', '11190': '영등포구', '11200': '동작구',
  '11210': '관악구', '11220': '서초구', '11230': '강남구', '11240': '송파구', '11250': '강동구',
}
const DISTRICT_CODES = Object.fromEntries(Object.entries(DISTRICTS).map(([code, name]) => [name, code]))

type BikeProperties = {
  sgg_cd?: string
  cot_conts_name?: string
  sub_cate_name?: string
  cot_value_01?: string
  cot_value_02?: string
  cot_addr_full_new?: string
  cot_addr_full_old?: string
  cot_line_color?: string
  cot_line_weight?: string
}

type BikeGeoJson = FeatureCollection<Geometry, BikeProperties>

type CycleGraphEdge = [
  from: number,
  to: number,
  lengthDm: number,
  kind: number,
  roadRank: number,
  coordinatesDm: number[],
]

type CycleGraph = {
  nodeScale: number
  edges: CycleGraphEdge[]
  kind: {
    general: number
    bike: number
  }
  stats: {
    generalNodes: number
    generalEdges: number
    bikeNodesAdded: number
    bikeEdges: number
  }
}

const escapeHtml = (value = '') => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
const resolveDistrictCode = (properties?: BikeProperties) => {
  if (properties?.sgg_cd && DISTRICTS[properties.sgg_cd]) return properties.sgg_cd
  const address = `${properties?.cot_addr_full_new || ''} ${properties?.cot_addr_full_old || ''}`
  const name = Object.keys(DISTRICT_CODES).find((districtName) => address.includes(districtName))
  return name ? DISTRICT_CODES[name] : undefined
}

function BikeRoadMap() {
  const mapElementRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const roadLayerRef = useRef<L.GeoJSON | null>(null)
  const graphLayerRef = useRef<L.LayerGroup | null>(null)
  const canvasRendererRef = useRef<L.Canvas | null>(null)
  const [data, setData] = useState<BikeGeoJson | null>(null)
  const [graph, setGraph] = useState<CycleGraph | null>(null)
  const [district, setDistrict] = useState('전체')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/data/seoul-cycle-graph.json').then((response) => {
        if (!response.ok) throw new Error('서울시 도로 네트워크를 불러오지 못했습니다.')
        return response.json() as Promise<CycleGraph>
      }),
      fetch('/data/seoul-bike-roads.geojson').then((response) => {
        if (!response.ok) throw new Error('서울시 자전거도로 데이터를 불러오지 못했습니다.')
        return response.json() as Promise<BikeGeoJson>
      }),
    ])
      .then(([cycleGraph, bikeRoads]) => {
        setGraph(cycleGraph)
        setData(bikeRoads)
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '데이터 오류가 발생했습니다.'))
      .finally(() => setLoading(false))
  }, [])

  const districtOptions = useMemo(() => {
    if (!data) return ['전체']
    const codes = new Set(data.features.map((feature) => resolveDistrictCode(feature.properties)).filter((code): code is string => Boolean(code)))
    return ['전체', ...Array.from(codes).sort((a, b) => DISTRICTS[a].localeCompare(DISTRICTS[b], 'ko'))]
  }, [data])

  const filteredData = useMemo<BikeGeoJson | null>(() => {
    if (!data) return null
    return {
      ...data,
      features: district === '전체' ? data.features : data.features.filter((feature) => resolveDistrictCode(feature.properties) === district),
    }
  }, [data, district])

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    filteredData?.features.forEach((feature) => {
      const category = feature.properties?.sub_cate_name || '기타'
      counts.set(category, (counts.get(category) ?? 0) + 1)
    })
    return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 4)
  }, [filteredData])

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return
    const map = L.map(mapElementRef.current, { zoomControl: false, preferCanvas: true }).setView([37.5665, 126.978], 11)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map)
    canvasRendererRef.current = L.canvas({ padding: 0.5 })
    mapRef.current = map
    setTimeout(() => map.invalidateSize(), 0)
    return () => {
      map.remove()
      mapRef.current = null
      canvasRendererRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const renderer = canvasRendererRef.current
    if (!map || !renderer || !graph) return

    graphLayerRef.current?.remove()
    const generalLines: L.LatLngExpression[][] = []
    const bikeLines: L.LatLngExpression[][] = []

    graph.edges.forEach((edge) => {
      const coordinates = edge[5]
      const line: L.LatLngExpression[] = []
      for (let index = 0; index < coordinates.length; index += 2) {
        const [lng, lat] = proj4(EPSG5174, WGS84, [
          coordinates[index] / graph.nodeScale,
          coordinates[index + 1] / graph.nodeScale,
        ])
        line.push([lat, lng])
      }
      if (line.length > 1) {
        const target = edge[3] === graph.kind.bike ? bikeLines : generalLines
        target.push(line)
      }
    })

    const generalLayer = L.polyline(generalLines, {
      renderer,
      color: '#65716b',
      weight: 1,
      opacity: 0.42,
      interactive: false,
    })
    const bikeLayer = L.polyline(bikeLines, {
      renderer,
      color: '#19895f',
      weight: 2.5,
      opacity: 0.95,
      interactive: false,
    })
    graphLayerRef.current = L.layerGroup([generalLayer, bikeLayer]).addTo(map)
  }, [graph])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !filteredData) return
    roadLayerRef.current?.remove()
    const layer = L.geoJSON(filteredData as FeatureCollection<Geometry, GeoJsonProperties>, {
      style: (feature) => {
        const properties = feature?.properties as BikeProperties | undefined
        return { color: properties?.cot_line_color || '#6f8f3d', weight: Math.min(5, Math.max(3, Number(properties?.cot_line_weight) || 4)), opacity: 0.88, lineCap: 'round', lineJoin: 'round' }
      },
      onEachFeature: (feature, road) => {
        const item = feature.properties as BikeProperties
        const resolvedCode = resolveDistrictCode(item)
        const districtName = resolvedCode ? DISTRICTS[resolvedCode] : ''
        const address = item.cot_addr_full_new || item.cot_addr_full_old || '-'
        road.bindPopup(`<div class="charger-popup bike-popup"><span class="popup-region">서울특별시 ${escapeHtml(districtName)}</span><strong>${escapeHtml(item.cot_conts_name || '자전거도로')}</strong><p>${escapeHtml(address)}</p><dl><div><dt>도로 유형</dt><dd>${escapeHtml(item.sub_cate_name || '-')}</dd></div><div><dt>기점</dt><dd>${escapeHtml(item.cot_value_01 || '-')}</dd></div><div><dt>종점</dt><dd>${escapeHtml(item.cot_value_02 || '-')}</dd></div></dl></div>`, { maxWidth: 320 })
      },
    }).addTo(map)
    roadLayerRef.current = layer
    const bounds = layer.getBounds()
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [25, 25], maxZoom: district === '전체' ? 12 : 15 })
  }, [filteredData, district])

  const featureCount = filteredData?.features.length ?? 0
  const networkEdgeCount = (graph?.stats.generalEdges ?? 0) + (graph?.stats.bikeEdges ?? 0)

  return <section className="charger-page bike-road-page">
    <aside className="charger-sidebar bike-sidebar">
      <div className="charger-brand-icon"><Bike size={22}/></div>
      <div className="charger-heading"><p>SEOUL BIKE NETWORK</p><h1>서울시 자전거도로<br/>분포</h1><span>서울 전역의 자전거도로 현황을 확인하세요.</span></div>
      <label className="region-select"><span><MapPin size={15}/> 자치구 선택</span><div><select value={district} onChange={(event) => setDistrict(event.target.value)}>{districtOptions.map((code) => <option value={code} key={code}>{code === '전체' ? '전체' : DISTRICTS[code]}</option>)}</select><ChevronDown size={16}/></div></label>
      <div className="charger-summary"><span>전체 도로 네트워크</span><strong>{networkEdgeCount.toLocaleString('ko-KR')}<small>개 링크</small></strong><p>일반도로 {(graph?.stats.generalEdges ?? 0).toLocaleString('ko-KR')} · 자전거도로 {(graph?.stats.bikeEdges ?? 0).toLocaleString('ko-KR')}</p></div>
      <div className="bike-categories">{categoryCounts.map((item, index) => <div key={item.name}><i className={`bike-color-${index}`}/><span>{item.name}</span><strong>{item.count}</strong></div>)}</div>
      <div className="charger-legend"><span><i className="general-road-line"/> 일반도로</span><span><i className="bike-road-line"/> 자전거도로</span></div>
    </aside>
    <div className="map-panel">
      <div className="map-top-card"><Navigation size={17}/><span>{district === '전체' ? '서울특별시 전체' : DISTRICTS[district]}</span><strong>{featureCount.toLocaleString('ko-KR')}개 구간</strong></div>
      <div className="bike-map-note"><Layers3 size={15}/> 선을 선택하면 상세정보를 볼 수 있습니다.</div>
      {loading && <div className="map-status"><LoaderCircle className="spinner" size={28}/><p>일반도로와 자전거도로 데이터를 불러오는 중입니다.</p></div>}
      {error && <div className="map-status error"><p>{error}</p></div>}
      <div ref={mapElementRef} className="leaflet-map" aria-label="서울시 자전거도로 분포 지도"/>
    </div>
  </section>
}

export default BikeRoadMap
