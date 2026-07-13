import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
  }>
  error?: { message?: string }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let requestId = ''
  let admin: ReturnType<typeof createClient> | null = null
  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) throw new Error('GEMINI_API_KEY가 Edge Function에 설정되지 않았습니다.')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401, headers: corsHeaders })
    admin = createClient(supabaseUrl, serviceRoleKey)
    const token = authHeader.replace('Bearer ', '')
    const { data: userData, error: userError } = await admin.auth.getUser(token)
    if (userError || !userData.user) return Response.json({ error: '유효하지 않은 로그인입니다.' }, { status: 401, headers: corsHeaders })

    const formData = await request.formData()
    const question = String(formData.get('question') ?? '').trim()
    const file = formData.get('file')

    if (!question && !(file instanceof File)) {
      return Response.json({ error: '질문 또는 파일이 필요합니다.' }, { status: 400, headers: corsHeaders })
    }

    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash'
    const effectiveQuestion = question || '첨부된 파일의 내용을 분석해 주세요.'
    const { data: requestRow, error: insertError } = await admin.from('ai_requests').insert({
      user_id: userData.user.id,
      question: effectiveQuestion,
      model,
      status: 'pending',
    }).select('id').single()
    if (insertError) throw insertError
    requestId = requestRow.id as string

    const parts: Array<Record<string, unknown>> = []
    const boundedPrompt = `다음 사용자 요청에 한국어로 답변하세요.

[답변 작성 규칙]
- 전체 답변을 최대 1,500토큰 이내로 작성하세요.
- API 출력 한도에 도달하기 전에 반드시 설명과 결론을 모두 완성하세요.
- 긴 서론, 반복, 불필요한 예시는 생략하고 핵심 내용을 우선하세요.
- 내용이 많으면 세부사항을 줄여서라도 문장을 중간에 끊지 마세요.
- 첨부 파일이 있다면 파일 내용을 바탕으로 답변하세요.

[사용자 요청]
${effectiveQuestion}`
    parts.push({ text: boundedPrompt })

    if (file instanceof File && file.size > 0) {
      const maxFileSize = 10 * 1024 * 1024
      if (file.size > maxFileSize) {
        throw new Error('파일 크기는 10MB 이하여야 합니다.')
      }

      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      const chunkSize = 0x8000
      for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
      }

      parts.push({
        inline_data: {
          mime_type: file.type || 'application/octet-stream',
          data: btoa(binary),
        },
      })

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const storagePath = `${userData.user.id}/${requestId}/${crypto.randomUUID()}-${safeName}`
      const { error: storageError } = await admin.storage.from('ai-request-files').upload(storagePath, file, { contentType: file.type, upsert: false })
      if (storageError) throw storageError
      const { error: metadataError } = await admin.from('ai_request_attachments').insert({ request_id: requestId, storage_path: storagePath, original_name: file.name, mime_type: file.type || null, file_size: file.size })
      if (metadataError) throw metadataError
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
        }),
      },
    )

    const result = await response.json() as GeminiResponse
    if (!response.ok) throw new Error(result.error?.message || `Gemini API 오류 (${response.status})`)

    const candidate = result.candidates?.[0]
    const answer = candidate?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim()

    if (!answer) throw new Error('Gemini가 빈 응답을 반환했습니다.')
    if (candidate?.finishReason === 'MAX_TOKENS') {
      throw new Error('AI 답변이 출력 한도를 초과했습니다. 요청 범위를 조금 줄여 다시 시도해 주세요.')
    }

    await admin.from('ai_requests').update({ answer, status: 'completed', error_message: null }).eq('id', requestId)

    return Response.json({ requestId, answer }, { headers: corsHeaders })
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
    if (admin && requestId) await admin.from('ai_requests').update({ status: 'failed', error_message: message }).eq('id', requestId)
    return Response.json({ error: message }, { status: 500, headers: corsHeaders })
  }
})
