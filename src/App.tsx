import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ArrowRight, Eye, EyeOff, FileText, LoaderCircle, LockKeyhole, LogOut, Mail, Send, Sparkles, UploadCloud, UserRound, X } from 'lucide-react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import Board from './components/Board'
import ChargerMap from './components/ChargerMap'
import MyPage from './components/MyPage'
import Dashboard from './components/Dashboard'
import AiHistory from './components/AiHistory'

type Mode = 'login' | 'signup'
type Page = 'home' | 'ai-history' | 'board' | 'dashboard' | 'charger' | 'mypage'

const authMessages: Record<string, string> = {
  'Invalid login credentials': '이메일 또는 비밀번호가 올바르지 않습니다.',
  'Email not confirmed': '이메일 인증을 먼저 완료해 주세요.',
  'User already registered': '이미 가입된 이메일입니다.',
  'Password should be at least 6 characters': '비밀번호는 6자 이상이어야 합니다.',
  'Unable to validate email address: invalid format': '올바른 이메일 주소를 입력해 주세요.',
}

function App() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [question, setQuestion] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [answer, setAnswer] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [asking, setAsking] = useState(false)
  const [currentPage, setCurrentPage] = useState<Page>('home')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })

    return () => data.subscription.unsubscribe()
  }, [])

  const switchMode = (nextMode: Mode) => {
    setMode(nextMode)
    setNotice(null)
    setPassword('')
    setCurrentPage('home')
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setNotice(null)

    if (!isSupabaseConfigured) {
      setNotice({ type: 'error', text: '.env.local에 Supabase 연결 정보를 입력해 주세요.' })
      return
    }

    if (mode === 'signup' && name.trim().length < 2) {
      setNotice({ type: 'error', text: '이름은 2자 이상 입력해 주세요.' })
      return
    }

    setSubmitting(true)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: name.trim() } },
        })
        if (error) throw error
        if (!data.session) {
          setNotice({ type: 'success', text: '가입 확인 메일을 보냈습니다. 이메일의 인증 링크를 눌러 주세요.' })
          setPassword('')
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '인증 중 문제가 발생했습니다.'
      setNotice({ type: 'error', text: authMessages[message] ?? message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleSignOut = async () => {
    setSubmitting(true)
    await supabase.auth.signOut()
    setSubmitting(false)
    setEmail('')
    setPassword('')
  }

  const selectFile = (file?: File) => {
    if (file) setAttachment(file)
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    selectFile(event.target.files?.[0])
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    selectFile(event.dataTransfer.files?.[0])
  }

  const handleQuestion = async (event: FormEvent) => {
    event.preventDefault()
    if (!question.trim() && !attachment) {
      setAnswer('질문을 입력하거나 참고할 파일을 첨부해 주세요.')
      return
    }

    setAsking(true)
    setAnswer('')
    try {
      const formData = new FormData()
      formData.append('question', question.trim() || '첨부된 파일의 내용을 분석해 주세요.')
      if (attachment) formData.append('file', attachment)

      const { data, error } = await supabase.functions.invoke<{ answer?: string; error?: string }>('ask-ai', {
        body: formData,
      })

      if (error) throw error
      if (!data?.answer) throw new Error(data?.error || 'AI 답변을 받지 못했습니다.')
      setAnswer(data.answer)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 요청 중 문제가 발생했습니다.'
      setAnswer(`요청을 처리하지 못했습니다. ${message}`)
    } finally {
      setAsking(false)
    }
  }

  if (loading) {
    return <main className="loading-screen"><LoaderCircle className="spinner" size={28} /></main>
  }

  if (session) {
    const displayName = session.user.user_metadata.display_name as string | undefined
    return (
      <div className="site-shell">
        <header className="topbar">
          <div className="topbar-inner">
            <div className="brand dark-brand"><span className="brand-mark">C</span><span>Circle</span></div>
            <nav aria-label="주요 메뉴">
              <button className={currentPage === 'home' ? 'active' : ''} onClick={() => setCurrentPage('home')}>홈</button>
              <button className={currentPage === 'ai-history' ? 'active' : ''} onClick={() => setCurrentPage('ai-history')}>AI 요청 기록</button>
              <button className={currentPage === 'board' ? 'active' : ''} onClick={() => setCurrentPage('board')}>게시판</button>
              <button className={currentPage === 'dashboard' ? 'active' : ''} onClick={() => setCurrentPage('dashboard')}>대시보드</button>
              <button className={currentPage === 'charger' ? 'active' : ''} onClick={() => setCurrentPage('charger')}>전국전동휠체어급속충전기 위치</button>
              <button className={currentPage === 'mypage' ? 'active' : ''} onClick={() => setCurrentPage('mypage')}>마이페이지</button>
            </nav>
            <button className="nav-signout" onClick={handleSignOut} disabled={submitting} aria-label="로그아웃">
              {submitting ? <LoaderCircle className="spinner" size={18} /> : <LogOut size={18} />}
              <span>로그아웃</span>
            </button>
          </div>
        </header>

        {currentPage === 'ai-history' ? <main className="ai-history-main"><AiHistory user={session.user} onAskAgain={(value) => { setQuestion(value); setCurrentPage('home') }} /></main> : currentPage === 'board' ? <main className="board-main"><Board user={session.user} /></main> : currentPage === 'dashboard' ? <main className="dashboard-main"><Dashboard user={session.user} onOpenBoard={() => setCurrentPage('board')} onOpenMyPage={() => setCurrentPage('mypage')} /></main> : currentPage === 'charger' ? <main className="charger-main"><ChargerMap /></main> : currentPage === 'mypage' ? <main className="mypage-main"><MyPage user={session.user} onOpenBoard={() => setCurrentPage('board')} /></main> : <main className="home-main">
          <section className="home-grid">
            <div className="request-panel">
              <div className="home-heading">
                <p className="home-eyebrow"><Sparkles size={14} /> AI ASSISTANT</p>
                <h1>환영합니다,<br /><strong>{displayName || '회원'}님.</strong></h1>
                <p>AI에게 무엇을 요청할까요?</p>
              </div>

              <form className="question-form" onSubmit={handleQuestion}>
                <label className="question-label" htmlFor="question">요청 내용</label>
                <textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="궁금한 내용이나 해결하고 싶은 일을 자유롭게 적어주세요." rows={6} />

                <div
                  className={`drop-zone ${isDragging ? 'dragging' : ''}`}
                  onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                >
                  <input ref={fileInputRef} type="file" onChange={handleFileChange} hidden />
                  {attachment ? (
                    <div className="selected-file">
                      <span className="file-icon"><FileText size={22} /></span>
                      <div><strong>{attachment.name}</strong><small>{(attachment.size / 1024).toFixed(1)} KB</small></div>
                      <button type="button" onClick={() => setAttachment(null)} aria-label="첨부 파일 삭제"><X size={18} /></button>
                    </div>
                  ) : (
                    <>
                      <span className="upload-icon"><UploadCloud size={24} /></span>
                      <div><strong>파일을 여기에 끌어다 놓으세요</strong><p>또는 <button type="button" onClick={() => fileInputRef.current?.click()}>파일 선택</button></p></div>
                    </>
                  )}
                </div>

                <button className="ask-button" type="submit" disabled={asking}>
                  {asking ? <><LoaderCircle className="spinner" size={18} /> 답변 생성 중...</> : <>질문하기 <Send size={18} /></>}
                </button>
              </form>
            </div>

            <div className="answer-panel">
              <div className="answer-title"><span><Sparkles size={18} /></span><h2>AI 대답:</h2></div>
              {asking ? (
                <div className="answer-empty"><LoaderCircle className="spinner ai-spinner" size={34} /><p>Gemini가 답변을 만들고 있어요.</p></div>
              ) : answer ? <p className="answer-text">{answer}</p> : (
                <div className="answer-empty">
                  <div className="answer-orbit"><Sparkles size={26} /></div>
                  <p>질문을 입력하면<br />AI의 답변이 여기에 표시됩니다.</p>
                </div>
              )}
            </div>
          </section>
        </main>}
      </div>
    )
  }

  return (
    <main className="app-shell">
      <div className="auth-layout">
        <section className="brand-panel">
          <div className="brand"><span className="brand-mark">C</span><span>Circle</span></div>
          <div className="brand-copy">
            <p className="eyebrow">WELCOME TO CIRCLE</p>
            <h1>좋은 시작은<br />가벼운 연결에서.</h1>
            <p>하나의 계정으로 더 간결하고<br />안전한 경험을 시작하세요.</p>
          </div>
          <p className="copyright">© 2026 Circle. All rights reserved.</p>
        </section>

        <section className="auth-panel">
          <div className="auth-card">
            <div className="mobile-brand"><span className="brand-mark">C</span><span>Circle</span></div>
            <div className="tabs" aria-label="인증 방식 선택">
              <button className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>로그인</button>
              <button className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')}>회원가입</button>
            </div>

            <div className="form-heading">
              <h2>{mode === 'login' ? '다시 만나 반가워요.' : '새로운 여정을 시작해요.'}</h2>
              <p>{mode === 'login' ? '계정 정보를 입력해 로그인하세요.' : '간단한 정보로 계정을 만들어 보세요.'}</p>
            </div>

            {!isSupabaseConfigured && (
              <div className="config-banner">Supabase 연결 전입니다. <code>.env.example</code>을 참고해 설정해 주세요.</div>
            )}

            <form onSubmit={handleSubmit}>
              {mode === 'signup' && (
                <label>
                  <span>이름</span>
                  <div className="input-wrap"><UserRound size={18} /><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" autoComplete="name" required /></div>
                </label>
              )}
              <label>
                <span>이메일</span>
                <div className="input-wrap"><Mail size={18} /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="email" required /></div>
              </label>
              <label>
                <span>비밀번호</span>
                <div className="input-wrap"><LockKeyhole size={18} /><input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'signup' ? '6자 이상 입력' : '비밀번호 입력'} minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /><button type="button" className="icon-button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
              </label>

              {notice && <div className={`notice ${notice.type}`} role="alert">{notice.text}</div>}

              <button className="primary-button" type="submit" disabled={submitting}>
                {submitting ? <LoaderCircle className="spinner" size={19} /> : <>{mode === 'login' ? '로그인' : '계정 만들기'}<ArrowRight size={19} /></>}
              </button>
            </form>

            <p className="switch-copy">{mode === 'login' ? '아직 계정이 없으신가요?' : '이미 계정이 있으신가요?'} <button onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}>{mode === 'login' ? '회원가입' : '로그인'}</button></p>
          </div>
        </section>
      </div>
    </main>
  )
}

export default App
