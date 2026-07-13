import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { ArrowLeft, ChevronLeft, ChevronRight, Download, FileText, Heart, LoaderCircle, Lock, Paperclip, PenLine, Plus, Search, Trash2, UploadCloud, X } from 'lucide-react'
import { supabase } from '../lib/supabase'

const PAGE_SIZE = 10
const PAGE_GROUP_SIZE = 5
const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_FILE_COUNT = 5
const ALLOWED_FILE_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
  'text/plain', 'text/csv', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip', 'application/x-zip-compressed',
]

type SearchField = 'title' | 'author_name'
type View = 'list' | 'create' | 'detail' | 'edit'

type Post = {
  id: string
  post_number: number
  author_id: string
  author_name: string
  title: string
  content: string
  is_secret: boolean
  like_count: number
  view_count: number
  created_at: string
  updated_at: string
}

type Attachment = {
  id: string
  post_id: string
  storage_path: string
  original_name: string
  mime_type: string | null
  file_size: number
  created_at: string
}

type PostForm = {
  title: string
  password: string
  content: string
  isSecret: boolean
  files: File[]
}

const emptyForm: PostForm = { title: '', password: '', content: '', isSecret: false, files: [] }

const formatDate = (value: string) => new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(value))

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function Board({ user }: { user: User }) {
  const [view, setView] = useState<View>('list')
  const [posts, setPosts] = useState<Post[]>([])
  const [selectedPost, setSelectedPost] = useState<Post | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(new Set())
  const [searchField, setSearchField] = useState<SearchField>('title')
  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [form, setForm] = useState<PostForm>(emptyForm)
  const [passwordModal, setPasswordModal] = useState<'delete' | null>(null)
  const [deletePassword, setDeletePassword] = useState('')

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const pageGroupStart = Math.floor((page - 1) / PAGE_GROUP_SIZE) * PAGE_GROUP_SIZE + 1
  const visiblePages = useMemo(() => Array.from(
    { length: Math.min(PAGE_GROUP_SIZE, totalPages - pageGroupStart + 1) },
    (_, index) => pageGroupStart + index,
  ), [pageGroupStart, totalPages])

  const loadPosts = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    let query = supabase
      .from('posts')
      .select('id, post_number, author_id, author_name, title, content, is_secret, like_count, view_count, created_at, updated_at', { count: 'exact' })
      .order('post_number', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

    if (searchTerm) query = query.ilike(searchField, `%${searchTerm}%`)

    const { data, error, count } = await query
    if (error) {
      setMessage({ type: 'error', text: `게시글을 불러오지 못했습니다. ${error.message}` })
      setPosts([])
    } else {
      setPosts((data as Post[]) ?? [])
      setTotalCount(count ?? 0)
    }
    setLoading(false)
  }, [page, searchField, searchTerm])

  const loadMyLikes = useCallback(async () => {
    const { data } = await supabase.from('post_likes').select('post_id').eq('user_id', user.id)
    setLikedPostIds(new Set(data?.map((item) => item.post_id as string) ?? []))
  }, [user.id])

  useEffect(() => { void loadPosts() }, [loadPosts])
  useEffect(() => { void loadMyLikes() }, [loadMyLikes])

  const openList = () => {
    setView('list')
    setSelectedPost(null)
    setAttachments([])
    setForm(emptyForm)
    setMessage(null)
    void loadPosts()
  }

  const openCreate = () => {
    setForm(emptyForm)
    setSelectedPost(null)
    setMessage(null)
    setView('create')
  }

  const openDetail = async (post: Post) => {
    const { data: nextViewCount, error: viewError } = await supabase.rpc('increment_post_view', { p_post_id: post.id })
    const viewedPost = viewError ? post : { ...post, view_count: nextViewCount as number }
    setSelectedPost(viewedPost)
    setPosts((current) => current.map((item) => item.id === post.id ? viewedPost : item))
    setView('detail')
    setMessage(null)
    const { data, error } = await supabase
      .from('post_attachments')
      .select('id, post_id, storage_path, original_name, mime_type, file_size, created_at')
      .eq('post_id', post.id)
      .order('created_at')
    if (error) setMessage({ type: 'error', text: error.message })
    setAttachments((data as Attachment[]) ?? [])
  }

  const openEdit = () => {
    if (!selectedPost) return
    setForm({
      title: selectedPost.title,
      content: selectedPost.content,
      password: '',
      isSecret: selectedPost.is_secret,
      files: [],
    })
    setMessage(null)
    setView('edit')
  }

  const changeFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? [])
    if (selectedFiles.length > MAX_FILE_COUNT) {
      setMessage({ type: 'error', text: `첨부파일은 최대 ${MAX_FILE_COUNT}개까지 선택할 수 있습니다.` })
      return
    }
    const oversized = selectedFiles.find((file) => file.size > MAX_FILE_SIZE)
    if (oversized) {
      setMessage({ type: 'error', text: `“${oversized.name}” 파일이 10MB를 초과합니다.` })
      return
    }
    const invalid = selectedFiles.find((file) => !ALLOWED_FILE_TYPES.includes(file.type))
    if (invalid) {
      setMessage({ type: 'error', text: `“${invalid.name}” 파일 형식은 업로드할 수 없습니다.` })
      return
    }
    setMessage(null)
    setForm((current) => ({ ...current, files: selectedFiles }))
  }

  const uploadAttachment = async (postId: string, file: File) => {
    const extension = file.name.includes('.') ? `.${file.name.split('.').pop()}` : ''
    const storagePath = `${user.id}/${postId}/${crypto.randomUUID()}${extension}`
    const { error: uploadError } = await supabase.storage.from('board-files').upload(storagePath, file)
    if (uploadError) throw uploadError

    const { error: metadataError } = await supabase.from('post_attachments').insert({
      post_id: postId,
      storage_path: storagePath,
      original_name: file.name,
      mime_type: file.type || null,
      file_size: file.size,
    })
    if (metadataError) {
      await supabase.storage.from('board-files').remove([storagePath])
      throw metadataError
    }
  }

  const submitPost = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      if (view === 'create') {
        const { data, error } = await supabase.rpc('create_board_post', {
          p_title: form.title,
          p_content: form.content,
          p_password: form.password,
          p_is_secret: form.isSecret,
        })
        if (error) throw error
        const postId = data as string
        for (const file of form.files) await uploadAttachment(postId, file)
        setMessage({ type: 'success', text: '게시글이 등록되었습니다.' })
        setPage(1)
        setSearchTerm('')
        setSearchInput('')
        setTimeout(openList, 500)
      } else if (view === 'edit' && selectedPost) {
        const { error } = await supabase.rpc('update_board_post', {
          p_post_id: selectedPost.id,
          p_title: form.title,
          p_content: form.content,
          p_password: form.password,
          p_is_secret: form.isSecret,
        })
        if (error) throw error
        const updated = { ...selectedPost, title: form.title.trim(), content: form.content.trim(), is_secret: form.isSecret }
        setSelectedPost(updated)
        setMessage({ type: 'success', text: '게시글이 수정되었습니다.' })
        setView('detail')
      }
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '요청을 처리하지 못했습니다.' })
    } finally {
      setSaving(false)
    }
  }

  const deletePost = async () => {
    if (!selectedPost) return
    setSaving(true)
    setMessage(null)
    const paths = attachments.map((file) => file.storage_path)
    const { error } = await supabase.rpc('delete_board_post', {
      p_post_id: selectedPost.id,
      p_password: deletePassword,
    })
    if (error) {
      setMessage({ type: 'error', text: error.message })
      setSaving(false)
      return
    }
    if (paths.length) await supabase.storage.from('board-files').remove(paths)
    setPasswordModal(null)
    setDeletePassword('')
    setSaving(false)
    openList()
  }

  const toggleLike = async (post: Post) => {
    const liked = likedPostIds.has(post.id)
    const { error } = liked
      ? await supabase.from('post_likes').delete().eq('post_id', post.id).eq('user_id', user.id)
      : await supabase.from('post_likes').insert({ post_id: post.id, user_id: user.id })
    if (error) {
      setMessage({ type: 'error', text: error.message })
      return
    }
    setLikedPostIds((current) => {
      const next = new Set(current)
      if (liked) next.delete(post.id); else next.add(post.id)
      return next
    })
    const delta = liked ? -1 : 1
    setPosts((current) => current.map((item) => item.id === post.id ? { ...item, like_count: item.like_count + delta } : item))
    if (selectedPost?.id === post.id) setSelectedPost({ ...selectedPost, like_count: selectedPost.like_count + delta })
  }

  const downloadAttachment = async (file: Attachment) => {
    const { data, error } = await supabase.storage.from('board-files').createSignedUrl(file.storage_path, 60, { download: file.original_name })
    if (error) setMessage({ type: 'error', text: error.message })
    else window.location.assign(data.signedUrl)
  }

  const search = (event: FormEvent) => {
    event.preventDefault()
    setPage(1)
    setSearchTerm(searchInput.trim())
  }

  if (view === 'create' || view === 'edit') {
    return (
      <section className="board-page">
        <button className="board-back" onClick={view === 'edit' ? () => setView('detail') : openList}><ArrowLeft size={18} /> 게시판으로</button>
        <div className="board-header"><div><p>COMMUNITY</p><h1>{view === 'create' ? '새 글 작성' : '게시글 수정'}</h1></div></div>
        <form className="post-form" onSubmit={submitPost}>
          <label><span>제목</span><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} maxLength={200} placeholder="제목을 입력하세요" required /></label>
          <label><span>게시글 비밀번호</span><input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} minLength={4} placeholder={view === 'edit' ? '작성 시 설정한 비밀번호' : '수정·삭제 시 사용할 4자 이상 비밀번호'} required /></label>
          <label><span>내용</span><textarea value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} rows={12} placeholder="내용을 입력하세요" required /></label>
          {view === 'create' && <label className="board-file"><span>첨부파일 <small>최대 5개 · 파일당 10MB</small></span><div><UploadCloud size={22} /><input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip" onChange={changeFile} /><span>{form.files.length ? `${form.files.length}개 파일 선택됨` : '파일을 선택하세요'}</span></div>{form.files.length > 0 && <ul className="selected-files">{form.files.map((file, index) => <li key={`${file.name}-${index}`}><FileText size={15} /><span>{file.name}</span><small>{formatBytes(file.size)}</small><button type="button" onClick={(event) => { event.preventDefault(); setForm((current) => ({ ...current, files: current.files.filter((_, fileIndex) => fileIndex !== index) })) }}><X size={15} /></button></li>)}</ul>}</label>}
          <label className="secret-check"><input type="checkbox" checked={form.isSecret} onChange={(event) => setForm({ ...form, isSecret: event.target.checked })} /><span><Lock size={15} /> 비밀글로 작성</span></label>
          {message && <div className={`board-message ${message.type}`}>{message.text}</div>}
          <div className="form-actions"><button type="button" className="board-outline-button" onClick={view === 'edit' ? () => setView('detail') : openList}>취소</button><button className="board-primary-button" disabled={saving}>{saving ? <LoaderCircle className="spinner" size={18} /> : null}{view === 'create' ? '등록하기' : '수정하기'}</button></div>
        </form>
      </section>
    )
  }

  if (view === 'detail' && selectedPost) {
    const isMine = selectedPost.author_id === user.id
    return (
      <section className="board-page">
        <button className="board-back" onClick={openList}><ArrowLeft size={18} /> 목록으로</button>
        {message && <div className={`board-message ${message.type}`}>{message.text}</div>}
        <article className="post-detail">
          <header><div className="post-badges">{selectedPost.is_secret && <span><Lock size={13} /> 비밀글</span>}<span>NO. {selectedPost.post_number}</span></div><h1>{selectedPost.title}</h1><div className="post-meta"><span>{selectedPost.author_name}</span><span>{formatDate(selectedPost.created_at)}</span><span>조회 {selectedPost.view_count}</span></div></header>
          <div className="post-content">{selectedPost.content}</div>
          {attachments.length > 0 && <div className="attachment-list"><strong><Paperclip size={16} /> 첨부파일</strong>{attachments.map((file) => <button key={file.id} onClick={() => void downloadAttachment(file)}><FileText size={17} /><span>{file.original_name}<small>{formatBytes(file.file_size)}</small></span><Download size={16} /></button>)}</div>}
          <footer><button className={`like-button ${likedPostIds.has(selectedPost.id) ? 'liked' : ''}`} onClick={() => void toggleLike(selectedPost)}><Heart size={18} fill={likedPostIds.has(selectedPost.id) ? 'currentColor' : 'none'} /> 좋아요 {selectedPost.like_count}</button>{isMine && <div className="owner-actions"><button onClick={openEdit}><PenLine size={16} /> 수정</button><button className="danger" onClick={() => setPasswordModal('delete')}><Trash2 size={16} /> 삭제</button></div>}</footer>
        </article>
        {passwordModal === 'delete' && <div className="modal-backdrop" onMouseDown={() => setPasswordModal(null)}><div className="password-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setPasswordModal(null)}><X size={19} /></button><div className="modal-icon"><Trash2 size={22} /></div><h2>게시글을 삭제할까요?</h2><p>삭제한 게시글은 복구할 수 없습니다.<br />게시글 비밀번호를 입력해 주세요.</p><input type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} placeholder="게시글 비밀번호" autoFocus /><div><button className="board-outline-button" onClick={() => setPasswordModal(null)}>취소</button><button className="delete-confirm" onClick={() => void deletePost()} disabled={saving || !deletePassword}>{saving ? <LoaderCircle className="spinner" size={17} /> : null}삭제</button></div></div></div>}
      </section>
    )
  }

  return (
    <section className="board-page">
      <div className="board-header"><div><p>COMMUNITY</p><h1>게시판</h1><span>자유롭게 이야기를 나누고 생각을 공유해 보세요.</span></div><button className="board-primary-button" onClick={openCreate}><Plus size={18} /> 글쓰기</button></div>
      <form className="board-search" onSubmit={search}><select value={searchField} onChange={(event) => setSearchField(event.target.value as SearchField)}><option value="title">제목</option><option value="author_name">작성자</option></select><div><Search size={18} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="검색어를 입력하세요" /></div><button>검색</button></form>
      {message && <div className={`board-message ${message.type}`}>{message.text}</div>}
      <div className="board-table-wrap">
        <div className="board-count">전체 <strong>{totalCount}</strong>개의 글</div>
        <table className="board-table"><thead><tr><th>번호</th><th>제목</th><th>작성자</th><th>작성일</th><th>조회</th><th>좋아요</th></tr></thead><tbody>{loading ? <tr><td colSpan={6} className="table-state"><LoaderCircle className="spinner" size={24} /></td></tr> : posts.length === 0 ? <tr><td colSpan={6} className="table-state">등록된 게시글이 없습니다.</td></tr> : posts.map((post) => <tr key={post.id}><td>{post.post_number}</td><td className="title-cell"><button onClick={() => void openDetail(post)}>{post.is_secret && <Lock size={14} />}<span>{post.title}</span>{post.author_id === user.id && <em>내 글</em>}</button></td><td>{post.author_name}</td><td>{formatDate(post.created_at)}</td><td>{post.view_count}</td><td><button className={`table-like ${likedPostIds.has(post.id) ? 'liked' : ''}`} onClick={() => void toggleLike(post)}><Heart size={15} fill={likedPostIds.has(post.id) ? 'currentColor' : 'none'} /> {post.like_count}</button></td></tr>)}</tbody></table>
      </div>
      <div className="pagination"><button onClick={() => setPage(1)} disabled={page === 1} aria-label="첫 페이지">«</button><button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}><ChevronLeft size={17} /></button>{visiblePages.map((number) => <button key={number} className={page === number ? 'active' : ''} onClick={() => setPage(number)}>{number}</button>)}<button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}><ChevronRight size={17} /></button><button onClick={() => setPage(totalPages)} disabled={page === totalPages} aria-label="마지막 페이지">»</button></div>
    </section>
  )
}

export default Board
