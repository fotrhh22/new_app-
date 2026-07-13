import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { ChevronLeft, ChevronRight, Clipboard, FileText, Heart, LoaderCircle, Paperclip, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

const PAGE_SIZE = 10
const PAGE_GROUP_SIZE = 5
type RequestItem = { id: string; question: string; answer: string | null; model: string; status: 'pending' | 'completed' | 'failed'; error_message: string | null; is_favorite: boolean; created_at: string }
type Attachment = { id: string; storage_path: string; original_name: string; file_size: number }

function AiHistory({ user, onAskAgain }: { user: User; onAskAgain: (question: string) => void }) {
  const [items, setItems] = useState<RequestItem[]>([])
  const [selected, setSelected] = useState<RequestItem | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [oldestFirst, setOldestFirst] = useState(false)
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const groupStart = Math.floor((page - 1) / PAGE_GROUP_SIZE) * PAGE_GROUP_SIZE + 1
  const pages = useMemo(() => Array.from({ length: Math.min(5, totalPages - groupStart + 1) }, (_, i) => groupStart + i), [groupStart, totalPages])

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('ai_requests').select('id, question, answer, model, status, error_message, is_favorite, created_at', { count: 'exact' }).eq('user_id', user.id).order('created_at', { ascending: oldestFirst }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    if (searchTerm) query = query.ilike('question', `%${searchTerm}%`)
    if (favoritesOnly) query = query.eq('is_favorite', true)
    const { data, error, count } = await query
    if (error) setMessage(error.message)
    else { setItems((data as RequestItem[]) ?? []); setTotalCount(count ?? 0) }
    setLoading(false)
  }, [favoritesOnly, oldestFirst, page, searchTerm, user.id])
  useEffect(() => { void load() }, [load])

  const choose = async (item: RequestItem) => {
    setSelected(item)
    const { data } = await supabase.from('ai_request_attachments').select('id, storage_path, original_name, file_size').eq('request_id', item.id)
    setAttachments((data as Attachment[]) ?? [])
  }
  const toggleFavorite = async (item: RequestItem) => {
    const next = !item.is_favorite
    const { error } = await supabase.from('ai_requests').update({ is_favorite: next }).eq('id', item.id)
    if (!error) { setItems((current) => current.map((value) => value.id === item.id ? { ...value, is_favorite: next } : value)); if (selected?.id === item.id) setSelected({ ...selected, is_favorite: next }) }
  }
  const remove = async (item: RequestItem) => {
    if (!window.confirm('이 AI 요청 기록을 삭제할까요?')) return
    const paths = selected?.id === item.id ? attachments.map((file) => file.storage_path) : []
    const { error } = await supabase.from('ai_requests').delete().eq('id', item.id)
    if (!error) { if (paths.length) await supabase.storage.from('ai-request-files').remove(paths); if (selected?.id === item.id) setSelected(null); void load() }
  }
  const download = async (file: Attachment) => {
    const { data } = await supabase.storage.from('ai-request-files').createSignedUrl(file.storage_path, 60, { download: file.original_name })
    if (data) window.location.assign(data.signedUrl)
  }
  const search = (event: FormEvent) => { event.preventDefault(); setPage(1); setSearchTerm(searchInput.trim()) }

  return <section className={`ai-history-page ${selected ? 'has-selection' : ''}`}>
    <div className="ai-history-list">
      <header><div><p>AI HISTORY</p><h1>AI 요청 기록</h1></div><span>{totalCount.toLocaleString('ko-KR')}건</span></header>
      <form onSubmit={search}><div><Search size={16}/><input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="질문 내용 검색"/></div><button>검색</button></form>
      <div className="history-filters"><button className={favoritesOnly ? 'active' : ''} onClick={() => { setFavoritesOnly(!favoritesOnly); setPage(1) }}><Heart size={13}/> 즐겨찾기</button><select value={oldestFirst ? 'old' : 'new'} onChange={(e) => { setOldestFirst(e.target.value === 'old'); setPage(1) }}><option value="new">최신순</option><option value="old">오래된순</option></select></div>
      {message && <div className="board-message error">{message}</div>}
      <div className="history-items">{loading ? <div className="history-empty"><LoaderCircle className="spinner" size={25}/></div> : items.length === 0 ? <div className="history-empty"><Sparkles size={24}/><p>저장된 AI 요청이 없습니다.</p></div> : items.map((item) => <button className={selected?.id === item.id ? 'active' : ''} key={item.id} onClick={() => void choose(item)}><span className={`history-status ${item.status}`}/><div><strong>{item.question}</strong><small>{new Date(item.created_at).toLocaleString('ko-KR')} · {item.status === 'completed' ? '답변 완료' : item.status === 'failed' ? '실패' : '처리 중'}</small></div>{item.is_favorite && <Heart size={14} fill="currentColor"/>}</button>)}</div>
      <div className="pagination history-pagination"><button onClick={() => setPage(1)} disabled={page === 1}>«</button><button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}><ChevronLeft size={15}/></button>{pages.map((value) => <button className={page === value ? 'active' : ''} key={value} onClick={() => setPage(value)}>{value}</button>)}<button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}><ChevronRight size={15}/></button><button onClick={() => setPage(totalPages)} disabled={page === totalPages}>»</button></div>
    </div>
    <div className="ai-history-detail">{selected ? <><header><div><span><Sparkles size={16}/></span><div><p>GEMINI RESPONSE</p><small>{selected.model}</small></div></div><div><button onClick={() => void toggleFavorite(selected)} title="즐겨찾기"><Heart size={17} fill={selected.is_favorite ? 'currentColor' : 'none'}/></button><button onClick={() => void remove(selected)} title="삭제"><Trash2 size={17}/></button></div></header><section><label>나의 질문</label><h2>{selected.question}</h2>{attachments.length > 0 && <div className="history-files"><Paperclip size={14}/>{attachments.map((file) => <button key={file.id} onClick={() => void download(file)}><FileText size={13}/>{file.original_name}</button>)}</div>}<label>AI 답변</label><div className={`history-answer ${selected.status}`}>{selected.status === 'completed' ? selected.answer : selected.status === 'failed' ? selected.error_message : '답변을 생성하고 있습니다.'}</div></section><footer><button onClick={() => navigator.clipboard.writeText(selected.answer ?? '')} disabled={!selected.answer}><Clipboard size={15}/> 답변 복사</button><button onClick={() => onAskAgain(selected.question)}><RefreshCw size={15}/> 다시 요청</button></footer></> : <div className="history-detail-empty"><span><Sparkles size={27}/></span><h2>AI 요청을 선택하세요.</h2><p>선택한 질문과 답변이 여기에 표시됩니다.</p></div>}</div>
  </section>
}
export default AiHistory
