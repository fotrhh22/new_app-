import { useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import Papa from 'papaparse'
import { ArrowRight, BatteryCharging, Eye, FileText, Heart, LayoutDashboard, LoaderCircle, Lock, TrendingUp } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Post = { id: string; title: string; author_name: string; author_id: string; is_secret: boolean; like_count: number; view_count: number; created_at: string }
type MonthStat = { month: string; count: number }
type RegionStat = { region: string; count: number }
type Stats = { posts: number; monthPosts: number; likes: number; chargers: number; myPosts: number; mySecrets: number; myLikes: number }

function Dashboard({ user, onOpenBoard, onOpenMyPage }: { user: User; onOpenBoard: () => void; onOpenMyPage: () => void }) {
  const [stats, setStats] = useState<Stats>({ posts: 0, monthPosts: 0, likes: 0, chargers: 0, myPosts: 0, mySecrets: 0, myLikes: 0 })
  const [monthly, setMonthly] = useState<MonthStat[]>([])
  const [regions, setRegions] = useState<RegionStat[]>([])
  const [popular, setPopular] = useState<Post[]>([])
  const [recentMine, setRecentMine] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const now = new Date()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
        const [allPosts, monthResult, myLikesResult, csvResponse] = await Promise.all([
          supabase.from('posts').select('id, title, author_name, author_id, is_secret, like_count, view_count, created_at'),
          supabase.from('posts').select('id', { count: 'exact', head: true }).gte('created_at', monthStart),
          supabase.from('post_likes').select('post_id', { count: 'exact', head: true }).eq('user_id', user.id),
          fetch('/data/location.csv'),
        ])
        if (allPosts.error) throw allPosts.error
        if (!csvResponse.ok) throw new Error('충전기 데이터를 불러오지 못했습니다.')
        const posts = (allPosts.data as Post[]) ?? []
        const csv = await csvResponse.text()
        const chargerRows = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true }).data
          .filter((row) => Number.isFinite(Number(row.위도)) && Number.isFinite(Number(row.경도)))

        const monthKeys = Array.from({ length: 6 }, (_, index) => {
          const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1)
          return { key: `${date.getFullYear()}-${date.getMonth()}`, month: `${date.getMonth() + 1}월` }
        })
        const monthCounts = new Map(monthKeys.map(({ key }) => [key, 0]))
        posts.forEach((post) => {
          const date = new Date(post.created_at)
          const key = `${date.getFullYear()}-${date.getMonth()}`
          if (monthCounts.has(key)) monthCounts.set(key, (monthCounts.get(key) ?? 0) + 1)
        })
        setMonthly(monthKeys.map(({ key, month }) => ({ month, count: monthCounts.get(key) ?? 0 })))

        const regionCounts = new Map<string, number>()
        chargerRows.forEach((row) => regionCounts.set(row.시도명, (regionCounts.get(row.시도명) ?? 0) + 1))
        setRegions(Array.from(regionCounts, ([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count).slice(0, 7))

        const totalLikes = posts.reduce((sum, post) => sum + post.like_count, 0)
        const mine = posts.filter((post) => post.author_id === user.id)
        setStats({ posts: posts.length, monthPosts: monthResult.count ?? 0, likes: totalLikes, chargers: chargerRows.length, myPosts: mine.length, mySecrets: mine.filter((post) => post.is_secret).length, myLikes: myLikesResult.count ?? 0 })
        setPopular([...posts].sort((a, b) => b.like_count - a.like_count || b.view_count - a.view_count || +new Date(b.created_at) - +new Date(a.created_at)).slice(0, 5))
        setRecentMine([...mine].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)).slice(0, 3))
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '대시보드를 불러오지 못했습니다.')
      } finally { setLoading(false) }
    }
    void load()
  }, [user.id])

  const cards = useMemo(() => [
    { label: '전체 게시글', value: stats.posts, icon: FileText, tone: 'green' },
    { label: '이번 달 게시글', value: stats.monthPosts, icon: TrendingUp, tone: 'amber' },
    { label: '전체 좋아요', value: stats.likes, icon: Heart, tone: 'rose' },
    { label: '전국 충전기', value: stats.chargers, icon: BatteryCharging, tone: 'purple' },
  ], [stats])

  return <section className="dashboard-page">
    <div className="dashboard-title"><div><p>DASHBOARD</p><h1>서비스 한눈에 보기</h1></div><span>게시판 활동과 충전기 현황을 확인하세요.</span></div>
    {error && <div className="board-message error">{error}</div>}
    <div className="dashboard-kpis">{cards.map(({ label, value, icon: Icon, tone }) => <article key={label}><span className={`kpi-icon ${tone}`}><Icon size={20} /></span><div><p>{label}</p><strong>{loading ? <LoaderCircle className="spinner" size={20} /> : value.toLocaleString('ko-KR')}<small>건</small></strong></div></article>)}</div>
    <div className="dashboard-grid">
      <article className="dash-card chart-card"><header><div><h2>게시글 작성 추이</h2><p>최근 6개월</p></div><LayoutDashboard size={18} /></header><div className="chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={monthly}><defs><linearGradient id="postGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8fa84a" stopOpacity={0.35}/><stop offset="95%" stopColor="#8fa84a" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#edf0eb"/><XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={11}/><YAxis allowDecimals={false} axisLine={false} tickLine={false} fontSize={11}/><Tooltip/><Area type="monotone" dataKey="count" stroke="#7f983e" strokeWidth={2} fill="url(#postGradient)"/></AreaChart></ResponsiveContainer></div></article>
      <article className="dash-card chart-card"><header><div><h2>지역별 충전기 분포</h2><p>충전소가 많은 상위 7개 지역</p></div><BatteryCharging size={18} /></header><div className="chart-area"><ResponsiveContainer width="100%" height="100%"><BarChart data={regions} layout="vertical" margin={{ left: 8 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#edf0eb"/><XAxis type="number" hide/><YAxis type="category" dataKey="region" width={55} axisLine={false} tickLine={false} fontSize={10}/><Tooltip/><Bar dataKey="count" fill="#a8c45b" radius={[0, 6, 6, 0]} barSize={15}/></BarChart></ResponsiveContainer></div></article>
      <article className="dash-card"><header><div><h2>인기 게시글 TOP 5</h2><p>좋아요와 조회수가 높은 글</p></div><button onClick={onOpenBoard}>전체 보기 <ArrowRight size={14}/></button></header><div className="popular-list">{popular.map((post, index) => <button key={post.id} onClick={onOpenBoard}><em>{index + 1}</em><span><strong>{post.is_secret && <Lock size={12}/>} {post.title}</strong><small>{post.author_name}</small></span><i><Heart size={12}/> {post.like_count}<Eye size={12}/> {post.view_count}</i></button>)}{!loading && popular.length === 0 && <p className="dash-empty">게시글이 없습니다.</p>}</div></article>
      <article className="dash-card"><header><div><h2>나의 활동</h2><p>내 게시판 활동 요약</p></div><button onClick={onOpenMyPage}>자세히 <ArrowRight size={14}/></button></header><div className="my-activity-numbers"><div><span>작성 글</span><strong>{stats.myPosts}</strong></div><div><span>비밀글</span><strong>{stats.mySecrets}</strong></div><div><span>누른 좋아요</span><strong>{stats.myLikes}</strong></div></div><div className="recent-mine">{recentMine.map((post) => <button key={post.id} onClick={onOpenBoard}>{post.is_secret && <Lock size={12}/>}<span>{post.title}</span></button>)}{!loading && recentMine.length === 0 && <p className="dash-empty">최근 작성한 글이 없습니다.</p>}</div></article>
    </div>
  </section>
}

export default Dashboard
