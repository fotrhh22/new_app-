import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import Papa from 'papaparse'
import type { FeatureCollection, Point } from 'geojson'
import { ChevronDown, LoaderCircle, MapPin, Navigation, Zap } from 'lucide-react'
import 'leaflet/dist/leaflet.css'

type ChargerRow = {
  시설명: string
  시도명: string
  시군구명: string
  소재지도로명주소: string
  소재지지번주소: string
  위도: string
  경도: string
  설치장소설명: string
  평일운영시작시각: string
  평일운영종료시각: string
  동시사용가능대수: string
  공기주입가능여부: string
  휴대전화충전가능여부: string
  관리기관전화번호: string
}

type ChargerProperties = Omit<ChargerRow, '위도' | '경도'>

const escapeHtml = (value = '') => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;')

function ChargerMap() {
  const mapElementRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const geoJsonLayerRef = useRef<L.GeoJSON | null>(null)
  const [rows, setRows] = useState<ChargerRow[]>([])
  const [region, setRegion] = useState('전체')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/data/location.csv')
      .then((response) => {
        if (!response.ok) throw new Error('충전기 위치 데이터를 불러오지 못했습니다.')
        return response.text()
      })
      .then((csv) => {
        const result = Papa.parse<ChargerRow>(csv, { header: true, skipEmptyLines: true })
        if (result.errors.length && !result.data.length) throw new Error('CSV 데이터를 읽을 수 없습니다.')
        setRows(result.data.filter((row) => Number.isFinite(Number(row.위도)) && Number.isFinite(Number(row.경도))))
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '데이터 오류가 발생했습니다.'))
      .finally(() => setLoading(false))
  }, [])

  const regions = useMemo(() => ['전체', ...Array.from(new Set(rows.map((row) => row.시도명).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko'))], [rows])
  const filteredRows = useMemo(() => region === '전체' ? rows : rows.filter((row) => row.시도명 === region), [region, rows])

  const geoJson = useMemo<FeatureCollection<Point, ChargerProperties>>(() => ({
    type: 'FeatureCollection',
    features: filteredRows.map((row) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number(row.경도), Number(row.위도)] },
      properties: {
        시설명: row.시설명,
        시도명: row.시도명,
        시군구명: row.시군구명,
        소재지도로명주소: row.소재지도로명주소,
        소재지지번주소: row.소재지지번주소,
        설치장소설명: row.설치장소설명,
        평일운영시작시각: row.평일운영시작시각,
        평일운영종료시각: row.평일운영종료시각,
        동시사용가능대수: row.동시사용가능대수,
        공기주입가능여부: row.공기주입가능여부,
        휴대전화충전가능여부: row.휴대전화충전가능여부,
        관리기관전화번호: row.관리기관전화번호,
      },
    })),
  }), [filteredRows])

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return
    const map = L.map(mapElementRef.current, { zoomControl: false, preferCanvas: true }).setView([36.25, 127.8], 7)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    mapRef.current = map
    setTimeout(() => map.invalidateSize(), 0)
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || loading) return
    if (geoJsonLayerRef.current) geoJsonLayerRef.current.remove()

    const layer = L.geoJSON(geoJson, {
      pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
        radius: 6,
        color: '#ffffff',
        weight: 2,
        fillColor: '#7e963d',
        fillOpacity: 0.92,
      }),
      onEachFeature: (feature, marker) => {
        const item = feature.properties as ChargerProperties
        const address = item.소재지도로명주소 || item.소재지지번주소 || '-'
        marker.bindPopup(`
          <div class="charger-popup">
            <span class="popup-region">${escapeHtml(item.시도명)} ${escapeHtml(item.시군구명)}</span>
            <strong>${escapeHtml(item.시설명 || '전동휠체어 충전소')}</strong>
            <p>${escapeHtml(address)}</p>
            ${item.설치장소설명 ? `<p class="popup-note">${escapeHtml(item.설치장소설명)}</p>` : ''}
            <dl>
              <div><dt>평일 운영</dt><dd>${escapeHtml(item.평일운영시작시각)}–${escapeHtml(item.평일운영종료시각)}</dd></div>
              <div><dt>동시 사용</dt><dd>${escapeHtml(item.동시사용가능대수 || '0')}대</dd></div>
              <div><dt>전화</dt><dd>${escapeHtml(item.관리기관전화번호 || '-')}</dd></div>
            </dl>
          </div>
        `, { maxWidth: 300 })
      },
    }).addTo(map)

    geoJsonLayerRef.current = layer
    const bounds = layer.getBounds()
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: region === '전체' ? 8 : 11 })
  }, [geoJson, loading, region])

  return (
    <section className="charger-page">
      <aside className="charger-sidebar">
        <div className="charger-brand-icon"><Zap size={21} /></div>
        <div className="charger-heading"><p>PUBLIC DATA MAP</p><h1>전국 전동휠체어<br />급속충전기</h1><span>가까운 충전시설을 지도에서 확인하세요.</span></div>
        <label className="region-select"><span><MapPin size={15} /> 지역 선택</span><div><select value={region} onChange={(event) => setRegion(event.target.value)}>{regions.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={16} /></div></label>
        <div className="charger-summary"><span>표시 중인 충전소</span><strong>{filteredRows.length.toLocaleString('ko-KR')}<small>개소</small></strong><p>EPSG:4326 · WGS 84</p></div>
        <div className="charger-legend"><span><i /> 급속충전기 위치</span></div>
      </aside>
      <div className="map-panel">
        <div className="map-top-card"><Navigation size={17} /><span>{region === '전체' ? '전국' : region}</span><strong>{filteredRows.length.toLocaleString('ko-KR')}곳</strong></div>
        {loading && <div className="map-status"><LoaderCircle className="spinner" size={28} /><p>위치 데이터를 불러오는 중입니다.</p></div>}
        {error && <div className="map-status error"><p>{error}</p></div>}
        <div ref={mapElementRef} className="leaflet-map" aria-label="전국 전동휠체어 급속충전기 지도" />
      </div>
    </section>
  )
}

export default ChargerMap
