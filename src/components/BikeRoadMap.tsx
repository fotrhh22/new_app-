import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { Bike, LoaderCircle, Navigation } from 'lucide-react'
import proj4 from 'proj4'
import 'leaflet/dist/leaflet.css'

const WGS84 = 'EPSG:4326'
const EPSG5174 = '+proj=tmerc +lat_0=38 +lon_0=127.002890277778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=-114.61998514,475.96296987,675.01832869,1.162,-2.347,-1.592,6.342 +units=m +no_defs'

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

function BikeRoadMap() {
  const mapElementRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const graphLayerRef = useRef<L.LayerGroup | null>(null)
  const canvasRendererRef = useRef<L.Canvas | null>(null)
  const [graph, setGraph] = useState<CycleGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/data/seoul-cycle-graph.json')
      .then((response) => {
        if (!response.ok) throw new Error('서울시 도로 네트워크를 불러오지 못했습니다.')
        return response.json() as Promise<CycleGraph>
      })
      .then(setGraph)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '데이터 오류가 발생했습니다.'))
      .finally(() => setLoading(false))
  }, [])

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
      color: '#27312c',
      weight: 1.3,
      opacity: 0.76,
      interactive: false,
    })
    const bikeLayer = L.polyline(bikeLines, {
      renderer,
      color: '#007a4d',
      weight: 3,
      opacity: 1,
      interactive: false,
    })
    graphLayerRef.current = L.layerGroup([generalLayer, bikeLayer]).addTo(map)
  }, [graph])

  const networkEdgeCount = (graph?.stats.generalEdges ?? 0) + (graph?.stats.bikeEdges ?? 0)

  return <section className="charger-page bike-road-page">
    <aside className="charger-sidebar bike-sidebar">
      <div className="charger-brand-icon"><Bike size={22}/></div>
      <div className="charger-heading"><p>SEOUL ROAD NETWORK</p><h1>서울시 도로<br/>네트워크</h1><span>일반도로와 자전거도로를 한눈에 확인하세요.</span></div>
      <div className="charger-summary"><span>전체 도로 네트워크</span><strong>{networkEdgeCount.toLocaleString('ko-KR')}<small>개 링크</small></strong><p>일반도로 {(graph?.stats.generalEdges ?? 0).toLocaleString('ko-KR')} · 자전거도로 {(graph?.stats.bikeEdges ?? 0).toLocaleString('ko-KR')}</p></div>
      <div className="charger-legend"><span><i className="general-road-line"/> 일반도로</span><span><i className="bike-road-line"/> 자전거도로</span></div>
    </aside>
    <div className="map-panel">
      <div className="map-top-card"><Navigation size={17}/><span>서울특별시 전체</span><strong>{networkEdgeCount.toLocaleString('ko-KR')}개 링크</strong></div>
      {loading && <div className="map-status"><LoaderCircle className="spinner" size={28}/><p>일반도로와 자전거도로 데이터를 불러오는 중입니다.</p></div>}
      {error && <div className="map-status error"><p>{error}</p></div>}
      <div ref={mapElementRef} className="leaflet-map" aria-label="서울시 일반도로와 자전거도로 네트워크 지도"/>
    </div>
  </section>
}

export default BikeRoadMap
