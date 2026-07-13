import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { CalendarDays, ChevronLeft, ChevronRight, FileText, Heart, LoaderCircle, Lock, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'

const PAGE_SIZE = 5
const PAGE_GROUP_SIZE = 5

type SecretPost = {
  id: string
  post_number: number
  title: string
  like_count: number
  view_count: number
  created_at: string
}

type Kpis = {
  likes: number
  secrets: number
  posts: number
  thisMonth: number
}

const formatDate = (value: string) => new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(value))

function MyPage({ user, onOpenBoard }: { user: User; onOpenBoard: () => void }) {
  const [kpis, setKpis] = useState<Kpis>({ likes: 0, secrets: 0, posts: 0, thisMonth: 0 })
  const [secretPosts, setSecretPosts] = useState<SecretPost[]>([])
  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [loadingKpis, setLoadingKpis] = useState(true)
  const [loadingPosts, setLoadingPosts] = useState(true)
  const [error, setError] = useState('')

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const pageGroupStart = Math.floor((page - 1) / PAGE_GROUP_SIZE) * PAGE_GROUP_SIZE + 1
  const visiblePages = useMemo(() => Array.from(
    { length: Math.min(PAGE_GROUP_SIZE, totalPages - pageGroupStart + 1) },
    (_, index) => pageGroupStart + index,
  ), [pageGroupStart, totalPages])

  useEffect(() => {
    const loadKpis = async () => {
      setLoadingKpis(true)
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const [likesResult, secretsResult, postsResult, monthResult] = await Promise.all([
        supabase.from('post_likes').select('post_id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('posts').select('id', { count: 'exact', head: true }).eq('author_id', user.id).eq('is_secret', true),
        supabase.from('posts').select('id', { count: 'exact', head: true }).eq('author_id', user.id),
        supabase.from('posts').select('id', { count: 'exact', head: true }).eq('author_id', user.id).gte('created_at', monthStart),
      ])
      const firstError = [likesResult.error, secretsResult.error, postsResult.error, monthResult.error].find(Boolean)
      if (firstError) setError(`KPI를 불러오지 못했습니다. ${firstError.message}`)
      setKpis({
        likes: likesResult.count ?? 0,
        secrets: secretsResult.count ?? 0,
        posts: postsResult.count ?? 0,
        thisMonth: monthResult.count ?? 0,
      })
      setLoadingKpis(false)
    }
    void loadKpis()
  }, [user.id])

  const loadSecretPosts = useCallback(async () => {
    setLoadingPosts(true)
    setError('')
    let query = supabase
      .from('posts')
      .select('id, post_number, title, like_count, view_count, created_at', { count: 'exact' })
      .eq('author_id', user.id)
      .eq('is_secret', true)
      .order('post_number', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    if (searchTerm) query = query.ilike('title', `%${searchTerm}%`)
    const { data, error: queryError, count } = await query
    if (queryError) {
      setError(`비밀글을 불러오지 못했습니다. ${queryError.message}`)
      setSecretPosts([])
    } else {
      setSecretPosts((data as SecretPost[]) ?? [])
      setTotalCount(count ?? 0)
    }
    setLoadingPosts(false)
  }, [page, searchTerm, user.id])

  useEffect(() => { void loadSecretPosts() }, [loadSecretPosts])

  const search = (event: FormEvent) => {
    event.preventDefault()
    setPage(1)
    setSearchTerm(searchInput.trim())
  }

  const cards = [
    { label: '좋아요', value: kpis.likes, icon: Heart, tone: 'rose' },
    { label: '비밀글', value: kpis.secrets, icon: Lock, tone: 'purple' },
    { label: '게시글', value: kpis.posts, icon: FileText, tone: 'green' },
    { label: '이번 달에 작성한 글', value: kpis.thisMonth, icon: CalendarDays, tone: 'amber' },
  ]

  return (
    <section className="mypage">
      <div className="mypage-top">
        <div className="mypage-heading">
          <div><p>MY ACTIVITY</p><h1>마이 페이지</h1></div>
          <span>{user.user_metadata.display_name || user.email}님의 활동을 한눈에 확인하세요.</span>
        </div>
        <div className="kpi-grid">
          {cards.map(({ label, value, icon: Icon, tone }) => (
            <article className="kpi-card" key={label}>
              <span className={`kpi-icon ${tone}`}><Icon size={20} /></span>
              <div><p>{label}</p><strong>{loadingKpis ? <LoaderCircle className="spinner" size={21} /> : value.toLocaleString('ko-KR')}<small>건</small></strong></div>
            </article>
          ))}
        </div>
      </div>

      <div className="mypage-bottom">
        <div className="secret-list-heading"><div><span><Lock size={16} /></span><div><h2>나의 비밀글</h2><p>나만 볼 수 있는 게시글을 관리하세요.</p></div></div><em>총 {totalCount.toLocaleString('ko-KR')}건</em></div>
        <form className="mypage-search" onSubmit={search}><div><Search size={18} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="비밀글 제목으로 검색" /></div><button>검색</button></form>
        {error && <div className="board-message error">{error}</div>}
        <div className="my-secret-table">
          <div className="my-secret-head"><span>번호</span><span>제목</span><span>작성일</span><span>조회</span><span>좋아요</span></div>
          {loadingPosts ? <div className="my-secret-empty"><LoaderCircle className="spinner" size={25} /></div> : secretPosts.length === 0 ? <div className="my-secret-empty"><Lock size={24} /><p>{searchTerm ? '검색 결과가 없습니다.' : '작성한 비밀글이 없습니다.'}</p></div> : secretPosts.map((post) => (
            <button className="my-secret-row" key={post.id} onClick={onOpenBoard} title="게시판에서 확인">
              <span>{post.post_number}</span><span className="my-secret-title"><Lock size={13} />{post.title}</span><span>{formatDate(post.created_at)}</span><span>{post.view_count}</span><span><Heart size={13} /> {post.like_count}</span>
            </button>
          ))}
        </div>
        <div className="pagination my-pagination"><button onClick={() => setPage(1)} disabled={page === 1} aria-label="첫 페이지">«</button><button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}><ChevronLeft size={17} /></button>{visiblePages.map((number) => <button key={number} className={page === number ? 'active' : ''} onClick={() => setPage(number)}>{number}</button>)}<button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}><ChevronRight size={17} /></button><button onClick={() => setPage(totalPages)} disabled={page === totalPages} aria-label="마지막 페이지">»</button></div>
      </div>
    </section>
  )
}

export default MyPage
