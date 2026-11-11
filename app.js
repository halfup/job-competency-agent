const root = document.getElementById('app');
const API_BASE = '/api';

async function apiRequest(path, options={}){
  const isForm=typeof FormData!=='undefined' && options.body instanceof FormData;
  const headers={...(options.headers||{})};
  if(!isForm && options.body!==undefined && !headers['Content-Type']) headers['Content-Type']='application/json';
  const token=localStorage.getItem('zhidao-token');
  if(token && !headers['Authorization']) headers['Authorization']='Bearer '+token;
  const res=await fetch(`${API_BASE}${path}`,{
    headers,
    ...options
  });
  if(!res.ok){
    let detail='';
    try{const errBody=await res.json();detail=errBody?.detail||errBody?.error?.message||'';}catch(e){}
    const err=new Error(detail||`API ${res.status}`);err.status=res.status;throw err;
  }
  const body=await res.json();
  if(body && body.ok===false) throw new Error(body.error?.message||'API error');
  return body?.data ?? body;
}

const S = {
  roles: [],
  resumes: [],
  activeResume: null,
  dashboard: null,
  serverSettings: null,
  backendReady: false,
  roleId: localStorage.getItem('zhidao-role') || 'java-backend',
  auth: { loggedIn: !!localStorage.getItem('zhidao-token'), mode: 'login', message: '', messageType: 'error', submitting: false, showPwd: false, showConfirm: false, remember: localStorage.getItem('zhidao-remember-on') === '1', strength: 0 },
  view: 'home',
  homeMode: null,
  jdReady: false,
  jobPrep: {
    screen: 'list',
    selectedId: 'byte-python',
    filter: 'all',
    query: '',
    processing: false,
    liveListening: false,
    company: '',
    targetRole: '',
    jd: '负责后端服务开发与系统性能优化；熟悉 Python 及常用 Web 框架，具备数据库、缓存、接口设计和线上问题排查能力；参与高并发系统建设，关注代码质量、稳定性和跨团队协作。',
    useResume: true,
    useProfile: true,
    reasonQuestion: null,
    records: [],
    loaded: false
  },
  interview: { started: false, mode: 'evaluation', sourceMode: 'resume', company: '', targetRole: '', jobJD: '', useResume: true, index: 0, answers: [], drafts: [], skipped: [], gap: null, resolved: false, sessionId:null, jobAnalysisId:null, backendQuestions:[], followupQuestion:null, lastEvidence:null },
  auditIndex: null,
  reportData: null,
  auditData: null,
  drill: { topic: localStorage.getItem('zhidao-training-domain') || 'sql', started: false, submitted: false, source: null, index: 0, answers: [], scores: [], feedbacks: [], sessionId: null, help: null, finished: false, createOpen: false },
  graph: { node: '', legendOpen: false, scale: 1, focusRelated: false, domain: localStorage.getItem('zhidao-training-domain') || 'sql', data: null },
  customDomains: (()=>{try{return JSON.parse(localStorage.getItem('zhidao-custom-domains')||'[]')}catch{return[]}})(),
  recordingAnalyzed: false,
  recording: {
    mode: 'dialogue',
    input: 'audio',
    company: '',
    role: 'Java 后端开发工程师',
    fileName: '',
    file: null,
    segments: [],
    transcriptionMeta: null,
    transcribing: false,
    text: '面试官：如果数据库更新成功但 Redis 删除失败怎么办？\n候选人：我们会记录失败任务并重试删除，同时设置合理过期时间，避免长期脏数据。',
    recordId: null,
    analysis: null,
    transcribed: false,
    analyzed: false
  },
  events: [],
  settings: { hints: true, autoProfile: true, evidenceStrict: true },
  resume: { tab: 'text', saved: false, fileName: '张同学_Java后端简历.pdf' },
  knowledge: { query: '', selected: null, imported: false, category: '全部', editorId: null, docs: [], loaded: false, searchResults: [], searchEngine: '', searching: false },
  historyFilter: '全部',
  historyData: null,
  copilotStarted: false,
  trainingAssist: null,
  ui: {
    toast: '',
    dark: localStorage.getItem('zhidao-dark') === '1',
    collapsed: localStorage.getItem('zhidao-sidebar-collapsed') === '1'
  },
  profile: { evidenceFilter: 'all', evidenceExpanded: false, data: null },
  agent: {
    messages: [],
    plan: [],
    planTitle: '',
    activeConversation: '结合我的画像，帮我安排准备计划',
    conversationId: null,
    conversations: [],
    loading: false
  }
};

async function refreshDashboard(){
  try{
    S.dashboard=await apiRequest(`/dashboard?role_id=${encodeURIComponent(S.roleId)}`);
    S.backendReady=true;
  }catch(err){
    console.warn('dashboard api unavailable',err);
  }
}

async function refreshServerSettings(){
  try{
    S.serverSettings=await apiRequest('/settings');
    const p=S.serverSettings?.preferences;
    if(p) S.settings={...S.settings,...p};
    S.backendReady=true;
  }catch(err){
    console.warn('settings api unavailable',err);
  }
}

async function refreshResumes(){
  try{
    S.resumes=await apiRequest('/resumes');
    S.activeResume=S.resumes.find(x=>x.is_active)||S.resumes[0]||null;
    if(S.activeResume) S.resume.fileName=S.activeResume.name;
    S.backendReady=true;
  }catch(err){
    console.warn('resumes api unavailable',err);
  }
}

function backendKnowledgeToUi(d){
  return {
    id:d.id,
    title:d.title,
    type:d.category||'核心知识',
    chunks:Number(d.chunk_count||0),
    meta:d.meta||'',
    updated:d.created_at?new Date(d.created_at).toLocaleDateString('zh-CN'):'刚刚',
    used:d.used||'专项训练 / 面试准备 / 成长 Agent',
    desc:d.desc||'',
    size:d.size||'文本资料',
    snippets:Array.isArray(d.snippets)?d.snippets:[],
    raw_text:d.raw_text||'',
    source_type:d.source_type||'text'
  };
}

async function refreshKnowledge(){
  try{
    const docs=await apiRequest('/knowledge');
    S.knowledge.docs=(docs||[]).map(backendKnowledgeToUi);
    S.knowledge.loaded=true;
    S.backendReady=true;
  }catch(err){
    console.warn('knowledge api unavailable',err);
  }
}

let knowledgeSearchTimer=null;
let knowledgeSearchSeq=0;

async function runKnowledgeSearch(query){
  const q=(query||'').trim();
  const seq=++knowledgeSearchSeq;
  if(!q){
    S.knowledge.searchResults=[];
    S.knowledge.searchEngine='';
    S.knowledge.searching=false;
    return;
  }
  S.knowledge.searching=true;
  try{
    const data=await apiRequest(`/knowledge/search?q=${encodeURIComponent(q)}&limit=6`);
    if(seq!==knowledgeSearchSeq)return;
    S.knowledge.searchResults=Array.isArray(data?.results)?data.results:[];
    S.knowledge.searchEngine=data?.engine||'';
  }catch(err){
    if(seq!==knowledgeSearchSeq)return;
    console.warn('knowledge smart search unavailable',err);
    S.knowledge.searchResults=[];
    S.knowledge.searchEngine='';
  }finally{
    if(seq===knowledgeSearchSeq){S.knowledge.searching=false;render();}
  }
}

async function refreshProfile(){
  try{
    S.profile.data=await apiRequest(`/profile?role_id=${encodeURIComponent(S.roleId)}`);
    S.backendReady=true;
  }catch(err){
    console.warn('profile api unavailable',err);
  }
}

async function refreshQuestionGraph(){
  try{
    S.graph.data=await apiRequest(`/question-graph?role_id=${encodeURIComponent(S.roleId)}`);
    const domains=S.graph.data?.domains||[];
    const savedDomain=localStorage.getItem('zhidao-training-domain');
    if(!savedDomain||!domains.some(x=>x.id===S.graph.domain)) S.graph.domain=S.graph.data?.default_domain||domains[0]?.id||'sql';
    S.backendReady=true;
  }catch(err){ console.warn('question graph api unavailable',err); }
}

async function refreshHistory(){
  try{
    S.historyData=await apiRequest(`/history?role_id=${encodeURIComponent(S.roleId)}`);
    S.backendReady=true;
  }catch(err){ console.warn('history api unavailable',err); }
}

function backendJobToPrep(x){
  const gaps=Array.isArray(x.gaps)?x.gaps:[];
  const strengths=Array.isArray(x.strengths)?x.strengths:[];
  const questions=Array.isArray(x.likely_questions)?x.likely_questions:[];
  const plan=Array.isArray(x.prep_plan)?x.prep_plan:[];
  const risks=gaps.filter(g=>g.priority==='high').length||gaps.length;
  return {
    id:x.job_analysis_id,
    company:x.company||'未填写公司',
    role:x.role_name||role().name,
    summary:`已映射 ${x.summary?.mapped_signal_count??(x.core_requirements||[]).length} 条 JD 要求，${gaps.length} 项能力仍待验证。`,
    match:Number(x.readiness??0),
    risks,
    resume:!!x.use_resume,
    created:x.created_at?new Date(x.created_at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'最近',
    status:'ready',
    raw:x,
    jd:x.raw_jd||'',
    strengths:strengths.map(s=>[s.name||s.competency_id,s.reason||'已有初步事实，仍需面试验证']),
    riskItems:gaps.map(g=>[g.name||g.competency_id,g.reason||'当前证据不足',g.priority==='high'?'高风险':'待验证']),
    questions:questions.map(q=>[q.competency_name||q.stage||'岗位能力',q.text]),
    strategy:plan.map(p=>p.title).filter(Boolean),
    resumeSize:S.activeResume?.name||'当前简历',
    profileDomains:(S.profile.data?.competencies||[]).length,
    weaknessCount:gaps.length
  };
}

async function refreshJobs(){
  try{
    const rows=await apiRequest('/jobs');
    S.jobPrep.records=(rows||[]).map(backendJobToPrep);
    S.jobPrep.loaded=true;
    if(S.jobPrep.records.length&&!S.jobPrep.records.some(x=>x.id===S.jobPrep.selectedId)) S.jobPrep.selectedId=S.jobPrep.records[0].id;
    S.backendReady=true;
  }catch(err){ console.warn('jobs api unavailable',err); }
}

async function refreshAssessmentReport(){
  if(!S.interview.sessionId)return null;
  try{
    S.reportData=await apiRequest(`/assessments/${encodeURIComponent(S.interview.sessionId)}/report`);
    S.backendReady=true;
    return S.reportData;
  }catch(err){ console.warn('assessment report api unavailable',err);return null; }
}

async function refreshAudit(index=S.auditIndex??0){
  const item=S.reportData?.competencies?.[index];
  if(!S.interview.sessionId||!item?.competency_id){S.auditData=null;return null;}
  try{
    S.auditData=await apiRequest(`/assessments/${encodeURIComponent(S.interview.sessionId)}/audit/${encodeURIComponent(item.competency_id)}`);
    return S.auditData;
  }catch(err){console.warn('assessment audit api unavailable',err);S.auditData=null;return null;}
}

async function createAssessmentSession(sourceMode='resume',jobAnalysisId=null){
  const payload={
    role_id:S.roleId,
    source_mode:sourceMode,
    resume_id:S.activeResume?.id||null,
    job_analysis_id:jobAnalysisId||null,
    mode:S.interview.mode||'evaluation'
  };
  const result=await apiRequest('/assessments',{method:'POST',body:JSON.stringify(payload)});
  S.interview.sessionId=result.session?.id||null;
  S.interview.jobAnalysisId=result.session?.job_analysis_id||jobAnalysisId||null;
  S.interview.backendQuestions=result.question?[result.question]:[];
  S.interview.index=0;
  S.interview.started=true;
  S.interview.gap=null;
  S.interview.followupQuestion=null;
  S.interview.lastEvidence=null;
  S.reportData=null;S.auditData=null;
  return result;
}

function appendBackendQuestion(q){
  if(!q)return;
  const exists=S.interview.backendQuestions.some(x=>x.id===q.id);
  if(!exists)S.interview.backendQuestions.push(q);
}

async function finishCurrentAssessment(reason='completed'){
  if(S.interview.sessionId){
    const result=await apiRequest(`/assessments/${encodeURIComponent(S.interview.sessionId)}/finish`,{method:'POST',body:JSON.stringify({reason})});
    S.reportData=result.report||null;
    await Promise.all([refreshProfile(),refreshHistory()]);
  }
  S.auditIndex=0;S.auditData=null;S.view='report';
  if(S.reportData)await refreshAudit(0);
}

async function loadAssessmentContext(sessionId,{openView='report'}={}){
  if(!sessionId)return false;
  try{
    const data=await apiRequest(`/assessments/${encodeURIComponent(sessionId)}`);
    const session=data.session||{};
    S.interview.sessionId=session.id||sessionId;
    S.interview.jobAnalysisId=session.job_analysis_id||null;
    S.interview.sourceMode=session.source_mode||'resume';
    S.interview.mode=session.mode||'evaluation';
    S.interview.started=session.status==='running';
    S.interview.backendQuestions=data.question?[data.question]:[];
    S.interview.index=0;
    S.interview.gap=null;
    S.interview.followupQuestion=null;
    S.interview.lastEvidence=null;
    if(session.job_analysis_id){
      if(!S.jobPrep.loaded)await refreshJobs();
      const prep=(S.jobPrep.records||[]).find(x=>x.id===session.job_analysis_id);
      if(prep){
        S.interview.company=prep.company||'';
        S.interview.targetRole=prep.role||role().name;
        S.interview.jobJD=prep.jd||'';
        S.interview.useResume=prep.resume!==false;
      }
    }
    if(session.status==='completed'||openView==='report'){
      await refreshAssessmentReport();
      S.auditIndex=0;S.auditData=null;
      if(S.reportData)await refreshAudit(0);
      S.view='report';
    }else{
      S.view='interview';
    }
    return true;
  }catch(err){
    console.warn('assessment context load failed',err);
    return false;
  }
}

async function loadLatestAssessmentReport(){
  await refreshHistory();
  const latest=(S.historyData?.items||[]).find(x=>x.type==='岗位评估'&&x.status==='已复盘');
  if(!latest)return false;
  return loadAssessmentContext(latest.id,{openView:'report'});
}

function frontendDrillTopic(topic){
  return ({redis:'middleware',system:'microservice',concurrency:'java',expression:'communication'})[topic]||topic||'sql';
}

async function openHistoryRecord(record){
  if(!record)return;
  if(record.type==='岗位评估'){
    const ok=await loadAssessmentContext(record.id,{openView:record.status==='已复盘'?'report':'interview'});
    if(!ok)notify('这次评估暂时无法恢复');
    return;
  }
  if(record.type==='JD 备面'){
    await refreshJobs();
    const prep=(S.jobPrep.records||[]).find(x=>x.id===record.id);
    if(prep){S.jobPrep.selectedId=prep.id;S.jobPrep.screen='detail';S.view='job';}
    else notify('这条 JD 备面记录已不存在');
    return;
  }
  if(record.type==='专项训练'){
    try{
      const d=await apiRequest(`/drills/${encodeURIComponent(record.id)}`);
      S.drill.topic=frontendDrillTopic(d.topic);
      S.drill.sessionId=d.id;
      S.drill.source=d.source_ref_id||d.source||'历史专项训练';
      S.drill.answers=[];S.drill.scores=[];S.drill.feedbacks=[];
      (d.attempts||[]).forEach(a=>{S.drill.answers[a.question_index]=a.raw_text;S.drill.scores[a.question_index]=Number(a.score);S.drill.feedbacks[a.question_index]=a.feedback||null;});
      S.drill.index=Math.max(0,Math.min((d.attempts||[]).length,Math.max(0,drillQuestions(S.drill.topic).length-1)));
      S.drill.started=true;S.drill.submitted=false;S.drill.finished=d.status==='completed';
      S.view='drill';
    }catch(err){console.warn('drill history load failed',err);notify('这次专项训练暂时无法恢复');}
    return;
  }
  if(record.type==='录音复盘'){
    try{
      const d=await apiRequest(`/recordings/${encodeURIComponent(record.id)}`);
      S.recording.recordId=d.id;S.recording.mode=d.mode||'dialogue';S.recording.input=d.input_type==='audio'?'audio':'text';S.recording.company=d.company||'';S.recording.role=d.role_name||'';S.recording.text=d.raw_text||'';S.recording.analysis=d.analysis||null;S.recording.transcriptionMeta=d.analysis?.transcription||null;S.recording.segments=(d.analysis?.asr_segments?.length?d.analysis.asr_segments:d.segments)||[];S.recording.fileName=d.analysis?.transcription?.original_name||'';S.recording.file=null;S.recording.transcribing=false;S.recording.transcribed=!!d.raw_text;S.recording.analyzed=d.status==='analyzed';S.recordingAnalyzed=S.recording.analyzed;S.view='recording';
    }catch(err){console.warn('recording history load failed',err);notify('这次录音复盘暂时无法恢复');}
  }
}

async function refreshAgentConversations(){
  try{
    S.agent.conversations=await apiRequest('/agent/conversations');
    S.backendReady=true;
  }catch(err){ console.warn('agent conversations api unavailable',err); }
}

const STATUS = { verified: '已验证', partial: '部分验证', gap: '存在缺口', unknown: '待验证' };
const EVIDENCE_LABELS={business_goal:'业务目标',responsibility:'本人职责',result:'结果',alternative:'备选方案',decision:'最终选择',tradeoff_reason:'选择依据',validation:'验证方式',performance_metric:'量化结果',index_column_order:'索引字段顺序',explain_before_after:'EXPLAIN 前后变化',metric:'监控指标',tool:'定位工具',diagnosis:'判断与根因',stop_loss:'止损动作',verification:'修复验证',action:'工程动作',reason:'原因',prevention:'预防机制',failure_compensation:'失败补偿',concurrency_boundary:'并发边界'};
function evidenceLabel(x){return EVIDENCE_LABELS[x]||x||'待补证据';}
const ICONS = {
  home: 'home', drill: 'target', interview: 'file', job: 'briefcase', recording: 'mic', profile: 'user',
  resume: 'resume', knowledge: 'book', history: 'clock', graph: 'sparkles', growth: 'sparkles', settings: 'settings', report: 'check'
};

function brandLogo(size=42){
  // 职到 ZD 矢量 logo：圆角方块 + 蓝青渐变 + 白色 Z 字路径 + 环形轨道（呼应「证据闭环」）
  return `<svg class="brand-logo-svg" viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true">
  <defs>
    <linearGradient id="zdlg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1d4ed8"/><stop offset=".58" stop-color="#3b82f6"/><stop offset="1" stop-color="#06b6d4"/>
    </linearGradient>
  </defs>
  <rect x="1" y="1" width="46" height="46" rx="13" fill="url(#zdlg)"/>
  <rect x="6" y="6" width="36" height="36" rx="9" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="1.4"/>
  <path d="M14 15h19v4.4l-13.2 13.2h-1.6l1.9-9H14z" fill="#fff"/>
  <path d="M24.4 15l-1.9 9h6.9L27.5 33h4.4L34 24h-6.9l3.4-9z" fill="#fff" opacity=".9"/>
  <circle cx="38" cy="10" r="2.2" fill="#fff" opacity=".55"/>
</svg>`;
}
function svgIcon(name, size=17){
  const p={
    home:'<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-7h5v7"/>',
    target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M18 6l3-3M18 3h3v3"/>',
    file:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/>',
    briefcase:'<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M3 12h18M10 12v2h4v-2"/>',
    mic:'<rect x="8" y="3" width="8" height="12" rx="4"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    resume:'<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M7 15h10M7 18h7M13 8h4M13 11h4"/>',
    book:'<path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22zM20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22z"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    sparkles:'<path d="m12 3 1.2 3.1L16 7.3l-2.8 1.2L12 12l-1.2-3.5L8 7.3l2.8-1.2zM18.5 13l.7 1.8L21 15.5l-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7zM6 14l1 2.5L9.5 17 7 18l-1 2.5L5 18l-2.5-1L5 16.5z"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/>',
    check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 2.6 2.6L16.5 9"/>',
    moon:'<path d="M20.3 15.2A8.5 8.5 0 0 1 8.8 3.7 8.5 8.5 0 1 0 20.3 15.2z"/>',
    chevron:'<path d="m14 6-6 6 6 6"/>',
    logout:'<path d="M10 4H5v16h5"/><path d="M13 8l4 4-4 4M17 12H9"/>',
    eye:'<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off':'<path d="M3 3l18 18"/><path d="M10.5 5.6A9.4 9.4 0 0 1 12 5.5c6.5 0 10 6.5 10 6.5a17 17 0 0 1-2.3 3.1M6.3 6.3A16.7 16.7 0 0 0 2 12s3.5 6.5 10 6.5a9 9 0 0 0 4.2-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    lock:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    phone:'<path d="M6 3h3l2 5-2.5 1.5a13 13 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
    'shield-check':'<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="m9 11.5 2 2 4-4.5"/>',
    'alert-circle':'<circle cx="12" cy="12" r="9"/><path d="M12 8v4.5M12 16h.01"/>',
    spinner:'<path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 3a9 9 0 0 1 9 9"/>'
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${p[name]||p.sparkles}</svg>`;
}

const NAV_GROUPS = [
  { label: '工作台', items: [['home','首页']] },
  { label: '面试训练', items: [['drill','专项训练'],['graph','题目图谱'],['interview','面试训练'],['job','JD 备面'],['recording','录音复盘']] },
  { label: '成长资产', items: [['profile','我的画像'],['resume','简历管理'],['knowledge','知识库'],['history','历史记录'],['report','评估报告']] },
  { label: 'AI 助手', items: [['growth','成长 Agent']] },
  { label: '工具', items: [['settings','设置']] }
];

const HOME_MODES = [
  { id:'resume', view:'interview', icon:'file', tone:'amber', title:'简历模拟面试', tag:'全流程模拟', desc:'读取简历与目标岗位，从自我介绍到项目深挖，用证据缺口驱动追问。' },
  { id:'topic', view:'drill', icon:'target', tone:'emerald', title:'专项强化训练', tag:'针对强化', desc:'选择一个薄弱能力集中训练，根据答题表现更新掌握度和长期画像。' },
  { id:'job', view:'job', icon:'briefcase', tone:'sky', title:'JD 定向备面', tag:'岗位针对', desc:'粘贴岗位 JD，拆解能力重点、证据槽位、优先级和高价值面试问题。' },
  { id:'recording', view:'recording', icon:'mic', tone:'blue', title:'录音复盘', tag:'真实面试', desc:'上传录音或粘贴转写文本，统一沉淀为问答证据并回流能力画像。' }
];

const DRILL_TOPICS = [
  {id:'sql', name:'SQL 与数据库', meta:'后端技术深度', score:64, due:'建议优先', question:'一个查询在数据量增长后从 90ms 变成 900ms，你会如何定位并验证优化是否有效？'},
  {id:'redis', name:'Redis 一致性', meta:'可靠性', score:58, due:'薄弱项', question:'数据库更新成功但 Redis 删除失败时，你会如何避免长期脏数据？'},
  {id:'java', name:'Java 并发', meta:'技术基础', score:76, due:'继续巩固', question:'线程池参数应该如何根据业务类型与系统约束设置？'},
  {id:'system', name:'系统设计', meta:'工程交付', score:72, due:'本周复习', question:'设计一个高并发预约系统，你会如何处理超卖、幂等和热点？'},
  {id:'communication', name:'结构化表达', meta:'沟通协作', score:82, due:'状态良好', question:'请用 90 秒向非技术面试官解释一次你做过的性能优化。'}
];

const DRILL_QUESTION_BANK = {
  sql: [
    ['一个查询在数据量增长后从 90ms 变成 900ms，你会如何定位并验证优化是否有效？','慢查询定位','中等'],
    ['联合索引包含 user_id、status、created_at 时，你会如何确定字段顺序？请说明判断依据。','联合索引设计','中等'],
    ['EXPLAIN 中 type=ALL、rows 很大，你会优先检查哪些信息？','执行计划分析','基础'],
    ['为什么“加了索引”仍可能不走索引？请结合至少三个常见场景说明。','索引失效','中等'],
    ['深分页 LIMIT 100000,20 很慢，你有哪些优化方案？分别适合什么条件？','分页优化','中等'],
    ['事务 A 和事务 B 同时更新同一批数据，如何降低死锁概率并快速定位死锁原因？','事务与锁','进阶'],
    ['一条 SQL 优化后平均耗时下降，但线上 P99 仍然很高，你会继续看什么？','性能验证','进阶'],
    ['什么时候应该考虑覆盖索引？它可能带来哪些写入和存储代价？','索引取舍','中等'],
    ['线上发现数据库 CPU 突然升高，你如何区分是 SQL、连接数、锁竞争还是流量突增？','故障定位','进阶'],
    ['请复盘一次数据库性能优化：问题、证据、方案对比、上线验证、回滚方案分别是什么？','项目复盘','进阶']
  ],
  redis: [
    ['数据库更新成功但 Redis 删除失败时，你会如何避免长期脏数据？','失败补偿','中等'],
    ['为什么“先更新数据库，再删除缓存”仍然可能出现短暂不一致？','一致性窗口','中等'],
    ['缓存穿透、击穿、雪崩分别是什么？你会如何区分和治理？','缓存风险','基础'],
    ['热点 Key 突然失效，大量请求打到数据库，你会如何止损？','热点保护','中等'],
    ['延迟双删解决什么问题？它有哪些局限，为什么不能被当成绝对一致方案？','延迟双删','进阶'],
    ['如果业务要求“最终一致但不能长期脏”，你会怎么设计重试与补偿队列？','补偿机制','进阶'],
    ['Redis 分布式锁为什么需要唯一 value？释放锁时为什么常用 Lua？','分布式锁','中等'],
    ['主从切换期间分布式锁可能发生什么问题？哪些业务不能只靠 Redis 锁？','锁边界','进阶'],
    ['大 Key 和热 Key 如何发现？分别会给系统带来什么风险？','容量治理','中等'],
    ['请设计一个缓存一致性监控方案：你会监控哪些指标、如何发现异常并回溯？','可观测性','进阶']
  ],
  java: [
    ['线程池参数应该如何根据业务类型与系统约束设置？','线程池参数','中等'],
    ['corePoolSize、maximumPoolSize、队列长度之间如何相互影响？','线程池机制','基础'],
    ['为什么不建议直接使用 Executors.newFixedThreadPool？','线程池风险','中等'],
    ['volatile 能保证什么，不能保证什么？请给出一个不能保证原子性的例子。','JMM','基础'],
    ['synchronized 和 ReentrantLock 在工程实践中你会如何选择？','锁机制','中等'],
    ['ConcurrentHashMap 为什么比 Hashtable 更适合高并发？','并发容器','中等'],
    ['CompletableFuture 多任务编排时，如何处理超时、异常和线程池隔离？','异步编排','进阶'],
    ['线上线程数持续增长，你会如何判断是线程泄漏、阻塞还是任务堆积？','线程诊断','进阶'],
    ['发生频繁 Full GC 时，你会从哪些 JVM 指标和对象特征入手定位？','JVM 诊断','进阶'],
    ['请讲一次你处理并发问题的经历：如何复现、定位、验证修复并防止回归？','项目复盘','进阶']
  ],
  system: [
    ['设计一个高并发预约系统，你会如何处理超卖、幂等和热点？','核心架构','进阶'],
    ['如果同一用户重复提交预约请求，如何保证接口幂等？','幂等设计','中等'],
    ['库存扣减放数据库、Redis 还是消息队列，各自适合什么场景？','方案取舍','进阶'],
    ['如何设计一个每秒 1 万请求的限流方案？你会在哪几层限流？','流量治理','中等'],
    ['消息发送成功但消费失败，如何保证业务最终完成且不重复执行？','消息可靠性','进阶'],
    ['接口依赖第三方服务且经常超时，你会如何做隔离、熔断和降级？','稳定性','中等'],
    ['如何避免某个热门场馆成为单点热点？','热点治理','中等'],
    ['如果数据库成为瓶颈，你会按什么顺序考虑缓存、读写分离、分库分表？','扩展路径','进阶'],
    ['系统出现局部故障时，哪些指标能帮助你快速判断影响范围？','可观测性','中等'],
    ['请用架构图思维描述一次完整请求链路，并指出三个最可能的故障点。','架构表达','进阶']
  ],
  communication: [
    ['请用 90 秒向非技术面试官解释一次你做过的性能优化。','结构化表达','基础'],
    ['请用 STAR 结构回答：你遇到过最棘手的线上问题是什么？','STAR 表达','中等'],
    ['面试官质疑“这个优化是不是你的贡献”，你会如何用证据说明自己的职责？','贡献边界','中等'],
    ['请把一个复杂技术方案解释给产品经理听，避免堆砌术语。','跨角色沟通','中等'],
    ['如果你和同事对技术方案意见不一致，你会如何推动决策？','冲突处理','中等'],
    ['项目结果不理想时，你会如何回答“这次失败你学到了什么”？','复盘表达','中等'],
    ['请用“背景—问题—行动—结果”四步介绍你的校园预约项目。','项目表达','基础'],
    ['当面试官连续追问细节而你不确定时，你会如何回答而不是硬猜？','边界意识','中等'],
    ['请把“系统性能提升很多”改写成一个可核验、可信的面试答案。','量化表达','基础'],
    ['请做一次 60 秒总结：为什么你适合 Java 后端开发工程师岗位？','岗位动机','中等']
  ]
};

const DRILL_GRAPH_NODES = [
  {id:'sql-slow',topic:'sql',q:0,x:120,y:155,label:'慢查询定位',score:64,status:'gap',domain:'SQL 与数据库'},
  {id:'sql-index',topic:'sql',q:1,x:315,y:95,label:'联合索引设计',score:72,status:'partial',domain:'SQL 与数据库'},
  {id:'sql-explain',topic:'sql',q:2,x:510,y:165,label:'执行计划分析',score:78,status:'partial',domain:'SQL 与数据库'},
  {id:'sql-lock',topic:'sql',q:5,x:720,y:100,label:'事务与锁',score:70,status:'gap',domain:'SQL 与数据库'},
  {id:'redis-comp',topic:'redis',q:0,x:210,y:345,label:'缓存失败补偿',score:58,status:'gap',domain:'Redis 一致性'},
  {id:'redis-window',topic:'redis',q:1,x:430,y:300,label:'一致性窗口',score:62,status:'gap',domain:'Redis 一致性'},
  {id:'redis-lock',topic:'redis',q:6,x:650,y:355,label:'分布式锁',score:74,status:'partial',domain:'Redis 一致性'},
  {id:'java-pool',topic:'java',q:0,x:845,y:260,label:'线程池参数',score:76,status:'partial',domain:'Java 并发'},
  {id:'java-jmm',topic:'java',q:3,x:805,y:475,label:'JMM / volatile',score:84,status:'verified',domain:'Java 并发'},
  {id:'system-core',topic:'system',q:0,x:530,y:505,label:'高并发预约架构',score:72,status:'partial',domain:'系统设计'},
  {id:'system-limit',topic:'system',q:3,x:305,y:505,label:'限流与流量治理',score:68,status:'gap',domain:'系统设计'},
  {id:'comm-story',topic:'communication',q:0,x:90,y:500,label:'结构化项目表达',score:82,status:'verified',domain:'结构化表达'}
];

const DRILL_GRAPH_EDGES = [
  ['sql-slow','sql-index','prerequisite'],['sql-index','sql-explain','related'],['sql-explain','sql-lock','related'],
  ['sql-slow','redis-comp','evidence'],['redis-comp','redis-window','prerequisite'],['redis-window','redis-lock','related'],
  ['redis-lock','java-pool','related'],['java-pool','java-jmm','prerequisite'],['java-pool','system-core','evidence'],
  ['system-limit','system-core','prerequisite'],['redis-window','system-core','evidence'],['comm-story','sql-slow','evidence'],
  ['comm-story','system-limit','related'],['sql-lock','system-core','related']
];

const AI_DRILL_TOPICS = [
  {id:'model',name:'模型与算法推理',meta:'模型推理',score:80,due:'继续巩固',question:'你如何判断一个更复杂的模型是否真的值得替换当前 baseline？'},
  {id:'data',name:'数据与实验',meta:'数据实验',score:74,due:'建议优先',question:'如何设计训练集、验证集和测试集，避免数据泄漏？'},
  {id:'error',name:'误差分析',meta:'问题解决',score:83,due:'状态良好',question:'模型整体指标不错，但关键样本表现差，你会怎么做误差归因？'},
  {id:'deploy',name:'工程部署',meta:'工程化',score:77,due:'继续巩固',question:'模型上线后延迟超标，你会从哪些层面定位和优化？'},
  {id:'ai-communication',name:'算法表达',meta:'沟通协作',score:86,due:'状态良好',question:'如何向业务方解释模型的不确定性与适用边界？'}
];
const AI_DRILL_QUESTION_BANK = {
  model:[
    ['你如何判断一个更复杂的模型是否真的值得替换当前 baseline？','模型选型','中等'],['分类任务类别极不均衡时，你会如何选择损失函数与评价指标？','不均衡学习','中等'],['Transformer 相比 RNN 的核心优势和主要代价是什么？','模型机制','基础'],['过拟合出现时，你会如何区分数据问题、模型容量问题和训练策略问题？','过拟合诊断','中等'],['一个新论文方法离线提升 1%，你会如何判断是否值得引入？','技术判断','进阶'],['特征工程和端到端模型之间你如何做取舍？','方案取舍','中等'],['为什么训练 loss 下降但验证指标不升反降？','泛化诊断','中等'],['模型效果提升来自数据还是结构，你会怎么设计消融实验？','消融实验','进阶'],['什么时候不应该继续追求更高模型复杂度？','边界判断','中等'],['请复盘一次模型选型：baseline、候选方案、验证方式和最终取舍分别是什么？','项目复盘','进阶']
  ],
  data:[
    ['如何设计训练集、验证集和测试集，避免数据泄漏？','数据切分','中等'],['时间序列任务为什么不能简单随机切分数据？','时间切分','中等'],['标签噪声较高时，你会如何发现并处理？','标签质量','中等'],['离线指标很好但线上效果差，你会优先检查哪些数据问题？','线上偏移','进阶'],['如何判断训练集与线上数据发生了分布漂移？','数据漂移','进阶'],['设计 A/B 实验时如何确定主指标和护栏指标？','实验指标','中等'],['样本量不足时如何判断实验结果是否可信？','统计显著性','进阶'],['多版本数据集如何保证实验可复现？','数据版本','基础'],['如何构建 hard case 数据集，并避免只对 hard case 过拟合？','难例治理','进阶'],['请设计一次完整模型实验：假设、变量、对照、指标和停止条件。','实验设计','进阶']
  ],
  error:[
    ['模型整体指标不错，但关键样本表现差，你会怎么做误差归因？','误差归因','中等'],['如何构建 confusion matrix 并从中决定下一步优化方向？','混淆分析','基础'],['某一类召回率突然下降，你会如何排查数据、阈值和模型变化？','类别诊断','中等'],['线上 bad case 很零散，如何把它们系统化成可行动的问题簇？','问题聚类','中等'],['模型在某些用户群体上表现更差，你如何验证是否存在偏差？','公平性分析','进阶'],['如何区分模型能力不足和输入信息不足？','信息边界','进阶'],['你会如何设计错误类型 taxonomy？','错误分类','中等'],['一个优化对平均指标有效但伤害长尾样本，你会如何取舍？','长尾取舍','进阶'],['如何证明某次优化真正解决了目标错误而不是偶然波动？','效果验证','中等'],['请复盘一次模型效果不达标时的定位与迭代过程。','迭代复盘','进阶']
  ],
  deploy:[
    ['模型上线后延迟超标，你会从哪些层面定位和优化？','推理延迟','中等'],['批处理、动态 batch 和实时推理分别适合什么场景？','服务策略','中等'],['模型量化可能带来哪些收益与精度风险？','模型压缩','中等'],['GPU 利用率很低但请求延迟高，你会如何排查？','资源诊断','进阶'],['模型服务如何做灰度发布与快速回滚？','发布治理','中等'],['如何监控线上模型效果，而不只监控服务 QPS 和延迟？','效果监控','进阶'],['模型版本和特征版本如何保证一致？','版本一致性','中等'],['高峰期模型服务容量不足时有哪些降级策略？','容量治理','进阶'],['推理成本上涨时如何从模型、硬件和调用策略三层优化？','成本优化','进阶'],['请设计一个模型服务的可观测性方案。','可观测性','进阶']
  ],
  'ai-communication':[
    ['如何向业务方解释模型的不确定性与适用边界？','边界表达','基础'],['请用非技术语言解释“精确率和召回率为什么不能同时无限提高”。','指标解释','中等'],['业务方只关心准确率，你如何说明还需要关注其他指标？','指标沟通','中等'],['如何汇报一次效果不达预期的算法项目？','风险沟通','中等'],['研究同学和工程同学对上线方案意见不一致时，你如何推动决策？','跨团队协作','中等'],['请用 90 秒介绍一个模型项目，避免堆模型名词。','项目表达','基础'],['怎么解释“离线提升但线上不一定提升”？','线上线下差异','中等'],['当你不知道某个算法细节时，如何诚实回答并保持专业？','边界意识','基础'],['如何把一个误差分析结论转成产品可执行动作？','行动转译','进阶'],['请总结为什么你适合 AI 算法工程师岗位。','岗位动机','中等']
  ]
};
const AI_GRAPH_NODES = [
  {id:'ai-baseline',topic:'model',q:0,x:120,y:150,label:'Baseline 与选型',score:80,status:'partial',domain:'模型与算法推理'},
  {id:'ai-overfit',topic:'model',q:3,x:335,y:100,label:'过拟合诊断',score:76,status:'partial',domain:'模型与算法推理'},
  {id:'ai-ablation',topic:'model',q:7,x:550,y:155,label:'消融实验',score:72,status:'gap',domain:'模型与算法推理'},
  {id:'ai-split',topic:'data',q:0,x:175,y:335,label:'数据切分',score:74,status:'partial',domain:'数据与实验'},
  {id:'ai-drift',topic:'data',q:4,x:400,y:305,label:'数据漂移',score:68,status:'gap',domain:'数据与实验'},
  {id:'ai-exp',topic:'data',q:9,x:625,y:345,label:'实验设计',score:75,status:'partial',domain:'数据与实验'},
  {id:'ai-error',topic:'error',q:0,x:825,y:160,label:'误差归因',score:83,status:'verified',domain:'误差分析'},
  {id:'ai-hard',topic:'error',q:3,x:820,y:385,label:'Bad Case 聚类',score:79,status:'partial',domain:'误差分析'},
  {id:'ai-latency',topic:'deploy',q:0,x:560,y:505,label:'推理延迟',score:77,status:'partial',domain:'工程部署'},
  {id:'ai-monitor',topic:'deploy',q:5,x:330,y:505,label:'线上效果监控',score:70,status:'gap',domain:'工程部署'},
  {id:'ai-boundary',topic:'ai-communication',q:0,x:95,y:500,label:'模型边界表达',score:86,status:'verified',domain:'算法表达'},
  {id:'ai-translate',topic:'ai-communication',q:8,x:845,y:505,label:'结论转业务动作',score:82,status:'verified',domain:'算法表达'}
];
const AI_GRAPH_EDGES = [
  ['ai-baseline','ai-overfit','prerequisite'],['ai-overfit','ai-ablation','related'],['ai-baseline','ai-split','evidence'],['ai-split','ai-drift','prerequisite'],['ai-drift','ai-exp','related'],['ai-exp','ai-error','evidence'],['ai-error','ai-hard','prerequisite'],['ai-drift','ai-monitor','evidence'],['ai-monitor','ai-latency','prerequisite'],['ai-latency','ai-hard','related'],['ai-boundary','ai-baseline','evidence'],['ai-boundary','ai-translate','related'],['ai-translate','ai-error','evidence'],['ai-exp','ai-latency','related']
];

const PRODUCT_DRILL_TOPICS = [
  {id:'user',name:'用户洞察',meta:'问题定义',score:84,due:'状态良好',question:'用户说“这个功能不好用”，你会如何继续追问并定义真实问题？'},
  {id:'priority',name:'需求优先级',meta:'方案设计',score:79,due:'继续巩固',question:'三个需求都说自己最紧急，你如何决定先做哪个？'},
  {id:'metrics',name:'指标与实验',meta:'数据指标',score:76,due:'建议优先',question:'一个新功能上线后，你如何定义它是否成功？'},
  {id:'execution',name:'跨团队执行',meta:'项目推进',score:81,due:'状态良好',question:'研发资源突然减少一半，你会如何调整范围和节奏？'},
  {id:'pm-communication',name:'产品表达',meta:'沟通表达',score:88,due:'状态良好',question:'请用 90 秒说明一个产品决策：问题、依据、取舍和结果。'}
];
const PRODUCT_DRILL_QUESTION_BANK = {
  user:[
    ['用户说“这个功能不好用”，你会如何继续追问并定义真实问题？','问题澄清','基础'],['用户访谈时如何避免诱导性提问？','访谈设计','中等'],['如何区分用户诉求、用户问题和产品方案？','问题定义','中等'],['定性反馈很多但相互矛盾时，你如何判断优先级？','反馈归因','中等'],['如何判断一个需求是高频痛点还是少数强烈声音？','需求验证','中等'],['设计用户画像时哪些信息真正有决策价值？','用户分层','中等'],['如何通过行为数据验证访谈结论？','定量验证','进阶'],['新用户和老用户诉求冲突时你如何处理？','用户分群','进阶'],['请设计一次围绕“校园预约效率”的用户研究。','研究设计','进阶'],['复盘一次你从模糊需求找到真实问题的经历。','项目复盘','进阶']
  ],
  priority:[
    ['三个需求都说自己最紧急，你如何决定先做哪个？','优先级判断','中等'],['RICE、Kano、MoSCoW 等方法你会如何选择而不是机械套公式？','优先级方法','中等'],['老板点名要做但数据不支持的需求，你会怎么处理？','向上沟通','进阶'],['如何定义一个 MVP 的最小范围？','MVP 设计','中等'],['技术债和新功能冲突时你如何分配资源？','资源取舍','进阶'],['同一个目标有三套方案，你如何形成决策记录？','方案比较','中等'],['需求价值很高但开发成本极高，如何拆阶段？','分阶段交付','中等'],['上线时间固定时如何做范围管理？','范围管理','中等'],['如何处理“所有需求都是 P0”的组织问题？','优先级治理','进阶'],['请复盘一次你主动砍掉功能的决策。','决策复盘','进阶']
  ],
  metrics:[
    ['一个新功能上线后，你如何定义它是否成功？','成功指标','基础'],['北极星指标和过程指标如何区分？','指标体系','中等'],['转化率上升但投诉率也上升，你如何判断是否成功？','护栏指标','中等'],['A/B 实验如何确定实验组、对照组和观察周期？','A/B 实验','中等'],['实验结果显著但业务价值很小，你会怎么决策？','结果解释','进阶'],['指标上涨但你怀疑是口径变化导致的，如何验证？','数据口径','中等'],['新功能使用率低，如何区分入口、价值和理解成本问题？','漏斗分析','中等'],['留存下降时你会如何拆 cohort？','留存分析','进阶'],['指标之间出现冲突时如何确定主次？','指标取舍','进阶'],['请设计一个校园预约产品的完整指标体系。','指标设计','进阶']
  ],
  execution:[
    ['研发资源突然减少一半，你会如何调整范围和节奏？','资源变化','中等'],['设计、研发对方案理解不一致时如何快速拉齐？','团队对齐','中等'],['需求进入开发后出现重大变更，你如何处理？','变更管理','中等'],['项目延期时你如何判断是计划问题还是执行问题？','延期诊断','中等'],['跨部门依赖方迟迟不交付，你会如何推动？','依赖管理','进阶'],['上线前发现高风险缺陷，你如何做 go/no-go 决策？','上线决策','进阶'],['如何设计项目里程碑和风险台账？','风险管理','中等'],['如何让需求文档减少研发返工？','需求质量','基础'],['上线后出现事故，产品经理应该承担哪些动作？','事故复盘','进阶'],['请复盘一次你推动多团队按期交付的项目。','交付复盘','进阶']
  ],
  'pm-communication':[
    ['请用 90 秒说明一个产品决策：问题、依据、取舍和结果。','决策表达','基础'],['如何向研发解释一个看起来“只是改文案”的需求价值？','价值沟通','中等'],['如何向老板汇报一个表现不好的功能？','向上汇报','中等'],['评审会上被连续质疑时如何保持结构化回答？','评审表达','中等'],['如何把用户反馈转成研发可执行需求？','需求转译','基础'],['跨团队发生冲突时如何围绕共同目标沟通？','冲突处理','中等'],['如何解释为什么暂时不做一个高呼声需求？','预期管理','中等'],['请用数据和用户事实说服团队接受一个方案。','说服能力','中等'],['你不确定一个问题答案时如何回应而不是拍脑袋？','边界意识','基础'],['请总结为什么你适合产品经理岗位。','岗位动机','中等']
  ]
};
const PRODUCT_GRAPH_NODES = [
  {id:'pm-problem',topic:'user',q:0,x:115,y:150,label:'问题澄清',score:84,status:'verified',domain:'用户洞察'},
  {id:'pm-interview',topic:'user',q:1,x:330,y:95,label:'用户访谈',score:81,status:'verified',domain:'用户洞察'},
  {id:'pm-validate',topic:'user',q:6,x:550,y:150,label:'行为数据验证',score:76,status:'partial',domain:'用户洞察'},
  {id:'pm-priority',topic:'priority',q:0,x:180,y:335,label:'需求优先级',score:79,status:'partial',domain:'需求优先级'},
  {id:'pm-mvp',topic:'priority',q:3,x:410,y:305,label:'MVP 范围',score:73,status:'gap',domain:'需求优先级'},
  {id:'pm-metric',topic:'metrics',q:0,x:635,y:340,label:'成功指标',score:76,status:'partial',domain:'指标与实验'},
  {id:'pm-ab',topic:'metrics',q:3,x:830,y:160,label:'A/B 实验',score:72,status:'gap',domain:'指标与实验'},
  {id:'pm-guardrail',topic:'metrics',q:2,x:820,y:390,label:'护栏指标',score:78,status:'partial',domain:'指标与实验'},
  {id:'pm-resource',topic:'execution',q:0,x:555,y:505,label:'资源变化',score:81,status:'verified',domain:'跨团队执行'},
  {id:'pm-risk',topic:'execution',q:6,x:330,y:505,label:'项目风险管理',score:75,status:'partial',domain:'跨团队执行'},
  {id:'pm-story',topic:'pm-communication',q:0,x:95,y:500,label:'产品决策表达',score:88,status:'verified',domain:'产品表达'},
  {id:'pm-conflict',topic:'pm-communication',q:5,x:845,y:505,label:'跨团队冲突沟通',score:82,status:'verified',domain:'产品表达'}
];
const PRODUCT_GRAPH_EDGES = [
  ['pm-problem','pm-interview','prerequisite'],['pm-interview','pm-validate','evidence'],['pm-problem','pm-priority','evidence'],['pm-priority','pm-mvp','prerequisite'],['pm-mvp','pm-metric','related'],['pm-metric','pm-ab','prerequisite'],['pm-ab','pm-guardrail','related'],['pm-mvp','pm-resource','evidence'],['pm-resource','pm-risk','prerequisite'],['pm-risk','pm-conflict','related'],['pm-story','pm-problem','evidence'],['pm-story','pm-priority','related'],['pm-conflict','pm-resource','evidence'],['pm-metric','pm-resource','related']
];

const ROLE_DRILL_CONFIGS = {
  'java-backend':{topics:DRILL_TOPICS,bank:DRILL_QUESTION_BANK,nodes:DRILL_GRAPH_NODES,edges:DRILL_GRAPH_EDGES,defaultTopic:'sql',defaultNode:'sql-slow'},
  'ai-algorithm':{topics:AI_DRILL_TOPICS,bank:AI_DRILL_QUESTION_BANK,nodes:AI_GRAPH_NODES,edges:AI_GRAPH_EDGES,defaultTopic:'model',defaultNode:'ai-baseline'},
  'product-manager':{topics:PRODUCT_DRILL_TOPICS,bank:PRODUCT_DRILL_QUESTION_BANK,nodes:PRODUCT_GRAPH_NODES,edges:PRODUCT_GRAPH_EDGES,defaultTopic:'user',defaultNode:'pm-problem'}
};

const TRAINING_DOMAINS = [
  {id:'java',name:'Java',meta:'编程语言',score:76,due:'高频核心',mark:'J',desc:'JVM、集合、并发、异常与工程实践',tags:['JVM','并发','集合']},
  {id:'python',name:'Python',meta:'编程语言',score:72,due:'岗位推荐',mark:'Py',desc:'语言机制、异步、Web 工程与数据处理',tags:['异步','Web','工程']},
  {id:'javascript',name:'JavaScript',meta:'编程语言',score:78,due:'前端基础',mark:'JS',desc:'事件循环、闭包、异步与浏览器机制',tags:['Event Loop','Promise','闭包']},
  {id:'go',name:'Go',meta:'编程语言',score:68,due:'拓展方向',mark:'Go',desc:'Goroutine、Channel、调度与服务工程',tags:['GMP','Channel','并发']},
  {id:'algorithm',name:'数据结构与算法',meta:'算法基础',score:74,due:'通用高频',mark:'DS',desc:'复杂度、数组链表、树图与经典算法',tags:['复杂度','树','动态规划']},
  {id:'sql',name:'SQL',meta:'数据库',score:64,due:'建议优先',mark:'SQL',desc:'索引、执行计划、事务锁与性能优化',tags:['索引','EXPLAIN','事务']},
  {id:'react',name:'React',meta:'前端框架',score:70,due:'前端方向',mark:'R',desc:'组件、Hooks、状态管理与性能优化',tags:['Hooks','状态','渲染']},
  {id:'spring',name:'Spring',meta:'Java 生态',score:75,due:'岗位推荐',mark:'S',desc:'IOC、AOP、事务、MVC 与 Spring Boot',tags:['IOC','事务','Boot']},
  {id:'rag',name:'RAG',meta:'AI 应用',score:66,due:'热门方向',mark:'RAG',desc:'检索、切分、Embedding、召回与评测',tags:['检索','Embedding','评测']},
  {id:'agent',name:'Agent',meta:'AI 应用',score:65,due:'热门方向',mark:'AI',desc:'工具调用、规划、记忆与可靠性控制',tags:['Tools','Planning','Memory']},
  {id:'middleware',name:'中间件与分布式',meta:'后端工程',score:61,due:'薄弱优先',mark:'MW',desc:'Redis、MQ、分布式锁、一致性与容错',tags:['Redis','MQ','一致性']},
  {id:'microservice',name:'微服务',meta:'系统设计',score:69,due:'岗位推荐',mark:'MS',desc:'服务拆分、网关、限流、熔断与治理',tags:['网关','限流','治理']}
];

const DOMAIN_QUESTION_BANK = {
  java:[
    ['为什么 String 被设计成不可变对象？这对线程安全和哈希有什么影响？','语言机制','基础'],
    ['HashMap 在 JDK 8 中什么时候由链表转红黑树？为什么要这样设计？','集合实现','中等'],
    ['volatile 能保证什么，不能保证什么？请给出一个反例。','JMM','基础'],
    ['线程池 corePoolSize、队列长度和 maximumPoolSize 如何共同决定吞吐与风险？','线程池','中等'],
    ['线上频繁 Full GC 时，你会按什么顺序定位？','JVM 诊断','进阶'],
    ['请复盘一次 Java 线上问题：如何复现、定位、修复和防止回归？','工程复盘','进阶']
  ],
  python:[
    ['Python 的 GIL 解决了什么问题，又限制了什么？','GIL','基础'],
    ['列表、生成器和迭代器在内存与执行模型上有什么区别？','迭代机制','基础'],
    ['asyncio 适合什么任务，不适合什么任务？','异步模型','中等'],
    ['Django / FastAPI 中你会如何设计接口超时、异常和日志链路？','Web 工程','中等'],
    ['Python 服务 CPU 高但 QPS 不高，你会如何排查？','性能诊断','进阶'],
    ['如何把一个脚本型 Python 项目改造成可维护的生产服务？','工程化','进阶']
  ],
  javascript:[
    ['事件循环中宏任务与微任务如何执行？Promise 回调属于哪一类？','Event Loop','基础'],
    ['闭包为什么会形成，什么情况下可能带来内存问题？','闭包','中等'],
    ['var、let、const 的作用域和提升行为有什么差异？','作用域','基础'],
    ['async/await 的错误处理和 Promise 链相比有哪些工程注意点？','异步编程','中等'],
    ['浏览器页面出现长任务和卡顿，你会如何定位？','性能分析','进阶'],
    ['如何设计一个可取消、可超时、可重试的前端请求层？','工程设计','进阶']
  ],
  go:[
    ['Goroutine 为什么比传统线程更轻量？','Goroutine','基础'],
    ['Channel 什么时候该用有缓冲，什么时候用无缓冲？','Channel','中等'],
    ['GMP 调度模型中的 G、M、P 分别是什么？','GMP','中等'],
    ['context.Context 在服务端请求链路中应该如何使用？','Context','基础'],
    ['Go 服务出现 Goroutine 泄漏，你会如何发现和定位？','并发诊断','进阶'],
    ['高并发 Go 服务如何控制连接池、超时和背压？','工程治理','进阶']
  ],
  algorithm:[
    ['时间复杂度 O(n log n) 和 O(n²) 在数据规模增大时差异在哪里？','复杂度','基础'],
    ['如何判断一道题更适合双指针、滑动窗口还是哈希表？','模式识别','中等'],
    ['二叉树 DFS 与 BFS 各适合解决哪些问题？','树遍历','基础'],
    ['什么情况下可以使用贪心？如何证明局部最优能导向全局最优？','贪心','进阶'],
    ['动态规划中状态定义、转移方程和边界条件分别怎么找？','动态规划','中等'],
    ['设计一个 LRU Cache，需要哪些数据结构才能做到 O(1)？','综合设计','进阶']
  ],
  sql:[
    ['一个查询从 90ms 变成 900ms，你会如何定位并验证优化有效？','慢查询定位','中等'],
    ['联合索引包含 user_id、status、created_at 时如何确定字段顺序？','联合索引','中等'],
    ['EXPLAIN 中 type=ALL、rows 很大，你会优先检查什么？','执行计划','基础'],
    ['为什么“加了索引”仍可能不走索引？请给出三个常见场景。','索引失效','中等'],
    ['事务并发更新同一批数据时，如何降低死锁概率并定位死锁？','事务与锁','进阶'],
    ['SQL 平均耗时下降但 P99 仍高，你会继续看什么？','性能验证','进阶']
  ],
  react:[
    ['React 为什么需要 key？错误使用 index 作为 key 会有什么问题？','列表渲染','基础'],
    ['useEffect 的依赖数组应该如何理解？常见闭包陷阱是什么？','Hooks','中等'],
    ['受控组件和非受控组件分别适合什么场景？','表单状态','基础'],
    ['React 状态更新为什么可能被批处理？','状态机制','中等'],
    ['页面出现大量无效重渲染时，你会如何定位和优化？','性能优化','进阶'],
    ['如何设计一个复杂页面的状态边界，避免所有状态都塞进全局 Store？','状态架构','进阶']
  ],
  spring:[
    ['Spring IOC 容器解决了什么问题？','IOC','基础'],
    ['Spring AOP 常见的使用场景和局限是什么？','AOP','基础'],
    ['@Transactional 为什么可能失效？请列出常见场景。','事务','中等'],
    ['Spring MVC 一次请求从 DispatcherServlet 到 Controller 经历什么？','MVC','中等'],
    ['Spring Boot 自动配置是如何工作的？','自动配置','中等'],
    ['线上 Spring 服务启动慢或 Bean 循环依赖，你会如何定位？','工程诊断','进阶']
  ],
  rag:[
    ['RAG 为什么需要文档切分？chunk 太大或太小分别有什么问题？','文档切分','基础'],
    ['Embedding 检索与关键词检索各自擅长什么？','检索机制','基础'],
    ['如何设计召回率、准确率和最终回答质量的 RAG 评测？','RAG 评测','中等'],
    ['多路召回后为什么还需要 rerank？','重排序','中等'],
    ['知识库更新频繁时，索引与版本如何管理？','索引治理','进阶'],
    ['回答出现幻觉时，如何判断问题来自检索、上下文还是生成模型？','错误归因','进阶']
  ],
  agent:[
    ['Agent 与普通 Chatbot 的核心区别是什么？','Agent 基础','基础'],
    ['工具调用失败时，Agent 应如何判断重试、换工具还是停止？','工具可靠性','中等'],
    ['规划型 Agent 为什么容易出现计划漂移？','规划控制','中等'],
    ['短期记忆、长期记忆和会话状态应该如何区分？','记忆设计','中等'],
    ['如何避免 Agent 因工具返回异常而连续执行错误动作？','安全边界','进阶'],
    ['你会如何评测一个 Agent 的任务完成率、成本和可解释性？','Agent 评测','进阶']
  ],
  middleware:[
    ['数据库更新成功但 Redis 删除失败时，如何避免长期脏数据？','Redis 一致性','中等'],
    ['缓存穿透、击穿、雪崩分别如何识别和治理？','缓存风险','基础'],
    ['Redis 分布式锁为什么需要唯一 value，释放锁为什么常用 Lua？','分布式锁','中等'],
    ['消息发送成功但消费失败时，如何保证最终完成且不重复？','消息可靠性','进阶'],
    ['Kafka Consumer 重平衡可能带来什么问题？','消息队列','中等'],
    ['如何为 Redis / MQ 设计监控、告警和故障降级？','中间件治理','进阶']
  ],
  microservice:[
    ['什么时候该拆微服务，什么时候不应该拆？','服务拆分','基础'],
    ['API 网关通常承担哪些职责？哪些职责不应该塞进网关？','网关','中等'],
    ['熔断、限流、降级三者的目标分别是什么？','稳定性治理','基础'],
    ['跨服务事务如何在一致性和可用性之间取舍？','分布式事务','进阶'],
    ['服务调用链出现级联超时，你会如何定位和止损？','故障治理','进阶'],
    ['如何设计微服务的日志、Trace、Metrics 三类可观测数据？','可观测性','中等']
  ]
};

const ROLE_DOMAIN_RECOMMENDATIONS = {
  'java-backend':['java','sql','spring','middleware','microservice'],
  'ai-algorithm':['model','data','error','deploy','ai-communication'],
  'product-manager':['user','priority','metrics','execution','pm-communication']
};

function roleDrillConfig(){ return ROLE_DRILL_CONFIGS[S.roleId]||ROLE_DRILL_CONFIGS['java-backend']; }
function roleSpecificDomains(){
  if(S.roleId==='java-backend')return [];
  return (roleDrillConfig().topics||[]).map(t=>({...t,mark:t.mark||t.name.slice(0,2),desc:t.desc||t.question||'岗位专项能力训练',tags:t.tags||[t.meta,t.due].filter(Boolean)}));
}
function allTrainingDomains(){
  const extraIds={
    'ai-algorithm':['python','algorithm','sql','rag','agent'],
    'product-manager':['agent','rag','sql','javascript','algorithm']
  }[S.roleId];
  const generic=extraIds?TRAINING_DOMAINS.filter(x=>extraIds.includes(x.id)):TRAINING_DOMAINS;
  const graphById=new Map((S.graph.data?.domains||[]).map(x=>[x.id,x]));
  const items=[...roleSpecificDomains(),...generic,...(S.customDomains||[])].map(x=>({...x,score:graphById.get(x.id)?.score??x.score}));
  return [...new Map(items.map(x=>[x.id,x])).values()];
}
function trainingDomain(id){ return allTrainingDomains().find(d=>d.id===id)||allTrainingDomains()[0]||TRAINING_DOMAINS[0]; }
function recommendedDomains(){ return ROLE_DOMAIN_RECOMMENDATIONS[S.roleId]||[]; }
function persistTrainingDomain(id){ S.drill.topic=id;S.graph.domain=id;localStorage.setItem('zhidao-training-domain',id); }
function backendDrillTopic(id){
  return ({middleware:'redis',microservice:'system',java:'concurrency',communication:'expression'})[id]||id;
}
function customDomainQuestions(domain){
  const name=domain?.name||'自定义领域';
  return domain?.questions?.length?domain.questions:[
    [`请用自己的话解释 ${name} 的核心概念，并给出一个实际使用场景。`,'核心概念','基础'],
    [`在 ${name} 中最常见的工程问题是什么？你会如何定位？`,'问题定位','中等'],
    [`请比较 ${name} 中两种常见方案，并说明你的选择依据。`,'方案取舍','中等'],
    [`如果 ${name} 相关方案上线后效果不达预期，你会如何验证和回滚？`,'验证与回滚','进阶'],
    [`请复盘一次你使用 ${name} 的经历：背景、行动、结果和边界分别是什么？`,'项目复盘','进阶']
  ];
}
function drillTopics(){ return allTrainingDomains(); }
function drillQuestions(topic){ const d=trainingDomain(topic);return roleDrillConfig().bank?.[topic]||DOMAIN_QUESTION_BANK[topic]||customDomainQuestions(d); }
function domainGraphNodes(domainId=S.graph.domain){
  const domain=trainingDomain(domainId);const bank=drillQuestions(domain.id);
  const pos=[[115,145],[325,90],[540,155],[205,355],[470,325],[745,390],[620,505],[875,195]];
  return bank.slice(0,Math.min(8,bank.length)).map((q,i)=>({id:`${domain.id}-q${i}`,topic:domain.id,q:i,x:pos[i][0],y:pos[i][1],label:q[1],score:Math.max(48,Math.min(94,domain.score+((i%3)-1)*6)),status:i===0&&domain.score<70?'gap':i%4===0?'verified':i%3===0?'gap':'partial',domain:domain.name}));
}
function domainGraphEdges(domainId=S.graph.domain){
  const nodes=domainGraphNodes(domainId);const id=i=>nodes[i]?.id;const base=[];
  [[0,1,'prerequisite'],[1,2,'related'],[0,3,'evidence'],[3,4,'prerequisite'],[2,5,'related'],[4,5,'evidence'],[1,4,'related'],[5,6,'prerequisite'],[2,7,'evidence']].forEach(([a,b,t])=>{if(id(a)&&id(b))base.push([id(a),id(b),t]);});
  return base;
}
function graphDomainData(id=S.graph.domain){ return S.graph.data?.domains?.find(d=>d.id===id)||null; }
function graphNodes(){ return graphDomainData()?.nodes||domainGraphNodes(S.graph.domain); }
function graphEdges(){ return graphDomainData()?.edges||domainGraphEdges(S.graph.domain); }
function graphNodeById(id){ const nodes=graphNodes(); return nodes.find(n=>n.id===id)||nodes[0]; }
function graphQuestion(node){ const d=graphDomainData(node?.topic);const q=d?.questions?.find(x=>x.index===node?.q||x.id===node?.question_id);return q?[q.text,q.label,q.difficulty]:drillQuestions(node.topic)[node.q]||drillQuestions(node.topic)[0]; }
function graphRelations(id){ return graphEdges().filter(e=>e[0]===id||e[1]===id).map(e=>({id:e[0]===id?e[1]:e[0],type:e[2],direction:e[0]===id?'out':'in'})); }
function competencyToTopic(id){
  const maps={
    'java-backend':{'backend-depth':'sql','reliability':'middleware','delivery-quality':'microservice','ownership':'microservice','collaboration':'java','learning':'java'},
    'ai-algorithm':{'model-reasoning':'model','data-experiment':'data','ml-engineering':'deploy','problem-solving':'error','communication':'ai-communication','learning':'model'},
    'product-manager':{'problem-definition':'user','solution-priority':'priority','metrics-experiment':'metrics','execution':'execution','communication':'pm-communication','business-learning':'user'}
  };
  return maps[S.roleId]?.[id]||recommendedDomains()[0]||'java';
}

function role(){ return S.roles.find(r => r.id === S.roleId) || S.roles[0] || {competencies:[],questions:[],jdSignals:[]}; }
function esc(v=''){ return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function userName(){ return localStorage.getItem('zhidao-user-name')||'张同学'; }
function avg(r){ const all=r.competencies||[]; const w=all.reduce((a,x)=>a+x.weight,0)||1; return Math.round(all.reduce((a,x)=>a+x.score*x.weight,0)/w); }
function pct(v){ return Math.max(0,Math.min(100,Number(v)||0)); }
function resetInterview(){ const prev=S.interview||{}; S.interview={started:false,mode:'evaluation',sourceMode:prev.sourceMode||'resume',company:prev.company||'',targetRole:prev.targetRole||'',jobJD:prev.jobJD||'',useResume:prev.useResume!==false,index:0,answers:[],drafts:[],skipped:[],gap:null,resolved:false,sessionId:null,jobAnalysisId:null,backendQuestions:[],followupQuestion:null,lastEvidence:null}; S.reportData=null;S.auditData=null; }
function resetDrillRun(){ S.drill.started=false;S.drill.submitted=false;S.drill.index=0;S.drill.answers=[];S.drill.scores=[];S.drill.feedbacks=[];S.drill.sessionId=null;S.drill.help=null;S.drill.finished=false; }
function modeInfo(){ return HOME_MODES.find(x=>x.id===S.homeMode); }

function shell(content){
  const groups = NAV_GROUPS.map(g => `<div class="nav-group"><div class="nav-label">${g.label}</div>${g.items.map(([id,name]) => `<button class="side-link ${S.view===id?'active':''}" data-nav="${id}"><span class="side-icon">${svgIcon(ICONS[id])}</span><span>${name}</span></button>`).join('')}</div>`).join('');
  const opts=(S.roles||[]).map(r=>`<option value="${r.id}" ${r.id===S.roleId?'selected':''}>${r.name}</option>`).join('');
  return `<div class="app-shell ${S.ui.dark?'dark-mode':''} ${S.ui.collapsed?'sidebar-collapsed':''}">
    <aside class="sidebar">
      <div class="brand">${brandLogo(42)}<div><div class="brand-name">职到 AI</div><div class="brand-desc">岗位胜任力评估智能体</div></div></div>
      <nav class="side-nav-scroll">${groups}</nav>
      <div class="side-bottom"><div class="mini-user"><div class="avatar">${esc((userName()||'张').slice(0,1))}</div><div><b>${esc(userName())}</b><span>Java 后端求职中</span></div></div><button class="side-link side-action" id="dark-toggle"><span class="side-icon">${svgIcon('moon')}</span><span>深色模式</span></button><button class="side-link side-action" id="collapse-sidebar"><span class="side-icon collapse-icon">${svgIcon('chevron')}</span><span>${S.ui.collapsed?'展开侧栏':'收起侧栏'}</span></button><button class="side-link logout-link" id="logout-btn"><span class="side-icon">${svgIcon('logout')}</span><span>退出登录</span></button></div>
    </aside>
    <main class="main">
      <header class="topbar"><div class="crumb"><span>职到 AI</span><b>/</b><strong>${pageTitle()}</strong></div><div class="top-actions"><button class="status-pill" data-nav="profile"><i></i><span>画像持续更新</span></button><select id="role-switch" class="role-select">${opts}</select></div></header>
      <div class="content">${content}</div>
    </main>
    ${S.ui.toast?`<div class="toast show">${svgIcon('check',15)}<span>${esc(S.ui.toast)}</span></div>`:''}
  </div>`;
}

function authView(){
  const login=S.auth.mode==='login';
  const msg=S.auth.message;
  const msgCls=S.auth.messageType==='success'?'auth-message success':'auth-message';
  const rememberedAccount=localStorage.getItem('zhidao-remember-account')||'';
  const pwdIcon=S.auth.showPwd?'eye-off':'eye';
  const pwdType=S.auth.showPwd?'text':'password';
  const confIcon=S.auth.showConfirm?'eye-off':'eye';
  const confType=S.auth.showConfirm?'text':'password';
  const str=S.auth.strength;
  const strMeta=[['',''],['弱','#ef4444'],['中','#f59e0b'],['强','#10b981']][str];
  const strBar=[0,1,2,3].map(i=>`<i class="${str>=i+1?'on':''}"></i>`).join('');
  const strBarCls=str>0?'lv'+str:'';
  const submitLabel=login?(S.auth.submitting?'登录中…':'登录并进入工作台'):(S.auth.submitting?'注册中…':'注册并开始使用');
  const accountIcon=login?'user':'phone';
  const nameField=login?'':'<label><span>姓名</span><div class="field-wrap"><span class="field-icon">'+svgIcon('user',15)+'</span><input id="auth-name" autocomplete="name" placeholder="请输入姓名"></div></label>';
  const pwdPlaceholder=login?'请输入密码':'请设置 8–20 位密码';
  const pwdAutocomplete=login?'current-password':'new-password';
  const pwdStrengthHtml=login?'':'<div class="pwd-strength"><div class="pwd-strength-bar '+strBarCls+'">'+strBar+'</div><span class="pwd-strength-text" style="color:'+strMeta[1]+'">'+strMeta[0]+'</span></div>';
  const confirmField=login?'':'<label><span>确认密码</span><div class="field-wrap password-wrap"><span class="field-icon">'+svgIcon('lock',15)+'</span><input id="auth-confirm" type="'+confType+'" autocomplete="new-password" placeholder="请再次输入密码"><button type="button" id="toggle-confirm" aria-label="显示或隐藏密码">'+svgIcon(confIcon,16)+'</button></div></label>';
  const messageHtml=msg?'<p class="'+msgCls+'">'+(S.auth.messageType==='error'?svgIcon('alert-circle',13)+' ':'')+esc(msg)+'</p>':'<p class="auth-message"></p>';
  const submitHtml='<button class="auth-submit" type="submit" '+(S.auth.submitting?'disabled':'')+'>'+(S.auth.submitting?svgIcon('spinner',15)+' ':'')+submitLabel+(S.auth.submitting?'':' <span>→</span>')+'</button>';
  const forgotHtml=login?'<div class="auth-forgot"><button type="button" class="text-link" id="forgot-password">忘记密码？</button></div>':'';
  const footSwitch=login?'还没有账号？ <button data-auth-mode="register">立即注册</button>':'已有账号？ <button data-auth-mode="login">返回登录</button>';
  const optionsHtml2=login?'<label class="remember"><input id="auth-remember" type="checkbox" '+(S.auth.remember?'checked':'')+'> <span>记住账号</span></label>':'<label class="remember"><input id="auth-agree" type="checkbox" checked> <span>我已阅读并同意服务条款与隐私说明</span></label>';
  return `<main class="auth-page">
  <div class="auth-aurora" aria-hidden="true"><i class="auth-blob b1"></i><i class="auth-blob b2"></i><i class="auth-blob b3"></i><i class="auth-grid"></i></div>
  <header class="auth-brand">${brandLogo(44)}<div><b>职到 AI</b><span>岗位胜任力评估</span></div></header>
  <section class="auth-shell">
    <div class="auth-copy">
      <div class="auth-kicker">${svgIcon('sparkles',15)} Evidence-grounded Assessment</div>
      <h1>把「我会什么」<br>变成<span>可验证的证据</span>。</h1>
      <p>不靠关键词打分。每条能力判定都会注明出处：JD 原句、面试追问和你的原话引用，逐层可回溯。</p>
      <div class="auth-benefits">
        <div>${svgIcon('target',18)}<div><b>岗位能力映射</b><small>JD 原句可追溯，能力要求逐条对应面试问题。</small></div></div>
        <div>${svgIcon('sparkles',18)}<div><b>Evidence 动态追问</b><small>证据不足先追问补证，不把未知直接计为低分。</small></div></div>
        <div>${svgIcon('clock',18)}<div><b>长期能力画像</b><small>评估、训练与录音复盘持续回流，沉淀成长轨迹。</small></div></div>
      </div>
    </div>
    <section class="auth-card">
      <div class="auth-tabs"><button class="${login?'active':''}" data-auth-mode="login">登录</button><button class="${!login?'active':''}" data-auth-mode="register">注册</button></div>
      <div class="auth-card-head"><h2>${login?'欢迎回来':'创建账号'}</h2><p>${login?'继续你的面试训练与能力成长记录。':'注册后即可保存简历、报告与长期能力画像。'}</p></div>
      <form id="auth-form" class="auth-form" novalidate>${nameField}<label><span>手机号或邮箱</span><div class="field-wrap"><span class="field-icon">${svgIcon(accountIcon,15)}</span><input id="auth-account" autocomplete="username" placeholder="请输入手机号或邮箱" value="${esc(rememberedAccount)}"></div></label><label><span>密码</span><div class="field-wrap password-wrap"><span class="field-icon">${svgIcon('lock',15)}</span><input id="auth-password" type="${pwdType}" autocomplete="${pwdAutocomplete}" placeholder="${pwdPlaceholder}"><button type="button" id="toggle-password" aria-label="显示或隐藏密码">${svgIcon(pwdIcon,16)}</button></div>${pwdStrengthHtml}</label>${confirmField}<div class="auth-options">${optionsHtml2}</div>${submitHtml}${forgotHtml}${messageHtml}</form>
      <div class="auth-foot">${footSwitch}</div>
    </section>
  </section>
  <footer class="auth-footer"><span>© 2026 职到 AI · 岗位胜任力评估智能体</span><span class="auth-footer-links"><a href="javascript:;">服务条款</a><a href="javascript:;">隐私说明</a><a href="javascript:;">帮助中心</a></span></footer>
</main>`;
}

function pageTitle(){
  if(S.view==='interview') return S.interview.sourceMode==='job'?'岗位面试':'简历面试';
  return ({home:'首页',drill:'专项训练',graph:'题目图谱',job:'JD 备面',recording:'录音复盘',profile:'我的画像',resume:'简历管理',knowledge:'知识库',history:'历史记录',report:'评估报告',growth:'成长 Agent',settings:'设置'})[S.view]||'';
}
function pageHead(kicker,title,desc,action=''){
  return `<section class="page-head"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${desc}</p></div>${action}</section>`;
}

function home(){
  const r=role();
  const homeTheme=({claude:'home-theme-claude',linuxdo:'home-theme-linuxdo',boss:'home-theme-boss'})[location.hash.replace('#','')]||'';
  const dash=S.dashboard||{};
  const coverage=Number(dash.coverage??81);
  const pending=Number(dash.pending_competencies??3);
  const weekly=Number(dash.weekly_training_count??4);
  const match=Number(dash.match_score??avg(r));
  const nextAction=dash.next_action||{title:'Redis 一致性专项训练',detail:'补齐失败补偿、高并发竞态和一致性边界证据。'};
  const modes=HOME_MODES.map(m=>`<button class="mode-card ${m.tone} ${S.homeMode===m.id?'selected':''}" data-mode="${m.id}">
    <div class="mode-glow"></div><div class="mode-top"><span class="mode-icon">${svgIcon(m.icon,20)}</span><span class="mode-tag">${m.tag}</span></div><h3>${m.title}</h3><p>${m.desc}</p><div class="mode-select">${S.homeMode===m.id?'已选择':'选择此模式'} <span>→</span></div>
  </button>`).join('');
  const selected=modeInfo();
  const comps=(r.competencies||[]).slice().sort((a,b)=>b.score-a.score);
  const mastery=comps.slice(0,4);
  const gaps=comps.filter(x=>x.status!=='verified').slice(0,3);
  return `<div class="home-wrap home-dashboard ${homeTheme}">
    <section class="home-dashboard-hero">
      <div class="home-hero-copy"><div class="hero-badge">${svgIcon('sparkles',14)} Evidence-grounded Assessment</div><span class="home-greeting">晚上好，张同学</span><h1>继续准备 <em>${r.name}</em></h1><p>系统会结合你的 JD、简历和历史回答，优先补齐尚未验证的岗位能力证据。</p><div class="hero-actions"><button class="primary big" data-nav="interview">继续岗位评估 →</button><button class="ghost big" data-nav="report">查看上次报告</button></div></div>
      <div class="hero-status-card"><div class="hero-score-ring"><strong>${match}</strong><span>岗位匹配度</span></div><div class="hero-status-copy"><div><span>评估覆盖率</span><b>${coverage}%</b></div><div><span>待验证能力</span><b>${pending} 项</b></div><div><span>本周训练</span><b>${weekly} 次</b></div></div></div>
    </section>

    <section class="home-section-head"><div><span>核心入口</span><h2>选择本轮训练方式</h2></div><p>四个入口共享同一套长期画像与证据记录。</p></section>
    <section class="mode-grid compact-modes">${modes}</section>
    ${selected?`<section class="start-panel home-selected-bar"><div><span class="selected-dot"></span><div><b>已选择：${selected.title}</b><span>${selected.desc}</span></div></div><button class="primary big" id="home-start">${selected.id==='resume'?'开始模拟面试':selected.id==='topic'?'开始专项训练':selected.id==='job'?'开始定向备面':'前往录音复盘'} <span>→</span></button></section>`:''}

    <section class="home-dashboard-grid">
      <article class="home-panel mastery-panel"><div class="home-panel-head"><div><span>能力画像</span><h3>当前岗位掌握度</h3></div><button class="text-link" data-nav="profile">查看完整画像 →</button></div><div class="home-mastery-list">${mastery.map(x=>`<div class="home-mastery-row"><div><b>${x.name}</b><span>${STATUS[x.status]||'待验证'}</span></div><strong>${x.score}</strong><div class="progress"><i style="width:${pct(x.score)}%"></i></div></div>`).join('')}</div></article>
      <article class="home-panel next-panel"><div class="home-panel-head"><div><span>下一步建议</span><h3>今天优先完成</h3></div><span class="badge blue">基于当前证据</span></div><div class="next-task primary-task"><div class="next-task-icon">${svgIcon('target',18)}</div><div><span>薄弱能力</span><b>${esc(nextAction.title)}</b><p>${esc(nextAction.detail||'继续补齐当前岗位的关键能力证据。')}</p></div><button class="secondary" data-nav="drill">开始训练</button></div><div class="next-task"><div class="next-task-icon soft">${svgIcon('briefcase',18)}</div><div><span>岗位准备</span><b>完善 JD 能力映射</b><p>继续确认数据库、缓存和稳定性要求的优先级。</p></div><button class="ghost" data-nav="job">去完善</button></div></article>
    </section>

    <section class="home-dashboard-grid lower-grid">
      <article class="home-panel recent-panel"><div class="home-panel-head"><div><span>最近活动</span><h3>评估与训练记录</h3></div><button class="text-link" data-nav="history">全部记录 →</button></div><div class="home-recent-list"><button data-nav="report"><span class="recent-type blue">评</span><div><b>Java 后端岗位评估</b><p>今天 18:10 · 覆盖率 81%</p></div><strong>79</strong><i>查看 →</i></button><button data-nav="profile"><span class="recent-type green">像</span><div><b>后端技术深度画像更新</b><p>今天 18:16 · EXPLAIN 与性能数据已写回</p></div><strong>+4</strong><i>查看 →</i></button><button data-nav="drill"><span class="recent-type orange">练</span><div><b>SQL 与数据库专项训练</b><p>09-06 20:40 · 过程证据更完整</p></div><strong>82</strong><i>继续 →</i></button></div></article>
      <article class="home-panel verify-panel"><div class="home-panel-head"><div><span>能力缺口</span><h3>待验证能力</h3></div><span class="verify-count">${pending} 项</span></div><div class="verify-list">${gaps.map((x,i)=>`<div class="verify-item"><span class="verify-state ${i===0?'risk':''}">${i===0?'优先':'待验证'}</span><div><b>${x.name}</b><p>${i===0?'当前证据不足，建议在下一轮追问中补齐。':'已有部分证据，尚未达到充分判断条件。'}</p></div><strong>${x.score}</strong></div>`).join('')}</div><button class="verify-cta" data-nav="interview">继续评估，提升覆盖率 <span>→</span></button></article>
    </section>

    <section class="home-footnote"><span>本轮岗位：<b>${r.name}</b></span><span>评估覆盖率：<b>${coverage}%</b></span><span>待验证能力：<b>${pending} 项</b></span><span>画像更新：<b>${Number(dash.profile_event_count??Math.max(1,S.events.length))} 条</b></span></section>
    <footer class="home-footer"><span>© 2026 职到 AI · 岗位胜任力评估智能体</span><span class="home-footer-links"><a href="javascript:;">使用帮助</a><a href="javascript:;">反馈建议</a><a href="javascript:;">关于职到</a></span></footer>
  </div>`;
}

function resume(){
  const r=role();
  const ar=S.activeResume;
  const structured=ar?.structured_json||{};
  const readiness=Number(structured.readiness_score??92);
  const rawResume=ar?.raw_text||'张同学｜计算机科学与技术\n目标：Java 后端开发工程师\n项目：校园场地预约服务\n职责：负责预约接口、MySQL 索引优化、Redis 热点缓存与线上问题排查。\n结果：接口平均响应从 420ms 降至 95ms。\n技能：Java、Spring Boot、MySQL、Redis、Docker';
  const firstProject=(structured.projects||[])[0]||{name:'校园场地预约服务',text:'负责预约接口、MySQL 索引优化、Redis 热点缓存与线上问题排查。通过联合索引与 SQL 优化，将接口平均响应从 420ms 降至 95ms。'};
  const parsedSkills=(structured.skills||['Java','Spring Boot','MySQL','Redis','Docker']);
  const tabs=[['structured','结构化编辑'],['text','粘贴文本'],['pdf','上传 PDF'],['word','上传 Word']];
  const tabButtons=tabs.map(([id,name])=>`<button class="tab ${S.resume.tab===id?'active':''}" data-resume-tab="${id}">${name}</button>`).join('');
  const claimRows=[];
  (structured.claims||[]).slice(0,3).forEach(c=>claimRows.push([c.normalized_name||c.claim_text,c.evidence_status==='project_evidence'?'已从项目经历提取到相关事实':'简历中出现该能力声明，仍需面试验证',c.evidence_status==='project_evidence'?'partial':'partial',c.evidence_status==='project_evidence'?'项目证据':'待验证']));
  (structured.evidence_gaps||[]).forEach(g=>claimRows.push([g.name,g.reason,g.status==='unknown'?'unknown':'gap',g.status==='unknown'?'待验证':'证据不足']));
  const claims=(claimRows.length?claimRows:[['Java / Spring Boot','简历技能 + 校园场地预约项目','partial','待验证'],['MySQL 索引优化','项目中出现 420ms → 95ms 量化结果','partial','部分证据'],['Redis 工程实践','项目使用明确，一致性边界仍不足','gap','证据不足'],['Kafka','当前简历未发现直接项目证据','unknown','待验证']]).slice(0,4);
  const libraryCards=(S.resumes.length?S.resumes:[ar].filter(Boolean)).map(x=>`<button class="resume-library-card ${x?.is_active?'active':''}" data-resume-select="${x?.id||''}"><div class="resume-paper-thumb"><div class="resume-paper-name">${esc(x?.structured_json?.name||'张同学')}</div><div class="resume-paper-role">${esc((x?.structured_json?.target_role||'JAVA BACKEND').toUpperCase())}</div><i></i><i></i><i class="short"></i><div class="resume-paper-section"></div><i></i><i></i><div class="resume-paper-section"></div><i></i><i class="short"></i></div><div class="resume-library-meta"><b>${esc(x?.name||S.resume.fileName)}</b><span>${x?.is_active?'当前使用':'可切换'} · ${esc(x?.source_type||'structured')}</span><em>结构化完成度 ${Number(x?.structured_json?.readiness_score??readiness)}%</em></div></button>`).join('');
  let editor='';
  if(S.resume.tab==='pdf'||S.resume.tab==='word') editor=`<div class="resume-upload-area"><input id="resume-file-input" type="file" accept="${S.resume.tab==='pdf'?'.pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document,.doc,.docx'}" hidden><div class="upload-icon">${svgIcon('resume',20)}</div><b>导入 ${S.resume.tab==='pdf'?'PDF':'Word'} 简历</b><span>导入后会转换为统一 Structured Resume。原文件保留用于预览，结构化内容用于岗位分析和面试。</span><button class="secondary" id="resume-pick-file">选择文件</button><small>支持拖拽上传 · 建议使用可复制文本的文件</small></div>`;
  else if(S.resume.tab==='structured') editor=`<div class="resume-editor-sections">
      <section class="resume-edit-block"><div class="resume-edit-title"><span>01</span><div><b>基本信息</b><small>用于建立候选人基础上下文</small></div></div><div class="resume-structured-grid"><div class="field"><label>姓名</label><input id="resume-name" value="${esc(structured.name||'张同学')}"></div><div class="field"><label>目标方向</label><input id="resume-target" value="${esc(structured.target_role||r.name)}"></div><div class="field"><label>学历</label><input id="resume-education" value="${esc(structured.education||'本科 · 计算机科学与技术')}"></div><div class="field"><label>求职状态</label><input id="resume-status" value="校招 / 实习"></div></div></section>
      <section class="resume-edit-block"><div class="resume-edit-title"><span>02</span><div><b>项目经历</b><small>面试最重要的事实来源</small></div></div><div class="resume-project-editor"><div class="resume-project-head"><div><b>${esc(firstProject.name)}</b><span>${esc(parsedSkills.slice(0,4).join(' · '))}</span></div><span class="badge verified">主项目</span></div><div class="field"><label>职责与结果</label><textarea id="resume-text">${esc(firstProject.text||rawResume)}</textarea></div><div class="resume-project-evidence"><span>${svgIcon('check',12)} 本人职责明确</span><span>${svgIcon('check',12)} ${structured.has_quantified_result?'有量化结果':'量化结果待补充'}</span><span class="warn">! 技术取舍待补充</span></div></div></section>
      <section class="resume-edit-block"><div class="resume-edit-title"><span>03</span><div><b>技能与关键词</b><small>只作为“应该验证什么”，不会直接计分</small></div></div><div class="resume-skill-tags">${parsedSkills.map(x=>`<span>${esc(x)}</span>`).join('')}${(structured.evidence_gaps||[]).some(x=>x.name==='Kafka')?'<span class="muted-tag">Kafka · 待补项目证据</span>':''}</div></section>
    </div><div class="resume-editor-actions"><span>${S.resume.saved?'已保存 · AI 解析已刷新':'有本地编辑内容尚未保存'}</span><button class="secondary" id="resume-save">保存并重新解析</button></div>`;
  else editor=`<div class="resume-text-editor"><div class="field"><div class="field-label-row"><label>简历原始文本</label><span>可直接成为面试输入</span></div><textarea id="resume-text">${esc(rawResume)}</textarea></div><div class="resume-editor-actions"><span>保存后会覆盖当前 Structured Resume 的文本来源</span><button class="secondary" id="resume-save">保存并重新解析</button></div></div>`;
  return `${pageHead('RESUME MANAGER','简历管理','管理用于求职和面试的简历版本。所有来源最终进入统一 Structured Resume，并生成“待验证能力”而不是直接把简历声明当成能力分。',`<div class="resume-head-actions"><button class="ghost" id="resume-new">＋ 新建简历</button><button class="primary" data-nav="interview">用当前简历面试 →</button></div>`)}
  <div class="resume-manager-shell">
    <aside class="resume-library-panel">
      <div class="resume-library-head"><div><span>简历库</span><h2>我的简历</h2></div><span class="badge blue">${Math.max(1,S.resumes.length)} 份</span></div>
      ${libraryCards}
      <div class="resume-library-actions"><button class="ghost" id="resume-replace">${svgIcon('resume',14)} 导入新文件</button><button class="ghost" id="resume-new-2">＋ 新建空白简历</button></div>
      <div class="resume-library-tip"><span>${svgIcon('sparkles',14)}</span><div><b>一份简历，多处复用</b><p>简历面试、JD 对照、成长 Agent 都会读取当前选中的 Structured Resume。</p></div></div>
    </aside>

    <main class="resume-editor-panel">
      <header class="resume-editor-head"><div><span>当前编辑</span><h2>${esc(ar?.name||S.resume.fileName)}</h2><p>来源：${esc(ar?.source_type||S.resume.tab)} · 解析引擎：${esc(ar?.parse_version||'rules-v1')}</p></div><span class="badge verified">当前简历</span></header>
      <div class="input-tabs resume-source-tabs">${tabButtons}</div>
      ${editor}
    </main>

    <aside class="resume-ai-panel">
      <section class="resume-ai-score"><div class="resume-ai-score-main"><div class="resume-ai-score-copy"><span>AI 解析</span><h2>简历可用度</h2><p>项目经历、技能声明和量化结果已转换为统一结构，后续面试会优先验证关键缺口。</p><em class="resume-ready-chip">${svgIcon('check',12)} ${readiness>=70?'已可直接用于面试':'建议先补充关键经历'}</em></div><div class="resume-score-ring" style="--resume-score:${readiness}"><div class="resume-score-core"><div><strong>${readiness}</strong><span>%</span></div><small>可用度</small></div></div></div><div class="resume-ai-alert"><span>仍需补充</span><p><b>${(structured.evidence_gaps||[]).length} 类关键证据</b>：${esc((structured.evidence_gaps||[]).map(x=>x.name).join('、')||'当前未发现明显结构缺口')}。</p></div><div class="resume-ai-kpis"><div><span class="resume-kpi-icon blue">${svgIcon('briefcase',13)}</span><div><b>${(structured.projects||[]).length}</b><span>核心项目</span></div></div><div><span class="resume-kpi-icon green">${svgIcon('check',13)}</span><div><b>${(structured.claims||[]).length}</b><span>能力声明</span></div></div><div><span class="resume-kpi-icon amber">${svgIcon('target',13)}</span><div><b>${(structured.evidence_gaps||[]).length}</b><span>证据缺口</span></div></div></div></section>
      <section class="resume-ai-section"><div class="resume-ai-title"><div><span>待验证能力</span><h3>系统会优先问这些</h3></div><button class="text-link" data-nav="profile">对照画像 →</button></div><div class="resume-claim-list">${claims.map(c=>`<div><span class="e-dot ${c[2]}"></span><div><b>${c[0]}</b><p>${c[1]}</p></div><em class="badge ${c[2]}">${c[3]}</em></div>`).join('')}</div></section>
      <section class="resume-ai-section resume-role-fit"><div class="resume-ai-title"><div><span>目标岗位</span><h3>${r.name}</h3></div><strong>${avg(r)}%</strong></div><div class="progress"><i style="width:${avg(r)}%"></i></div><p>简历已经覆盖数据库与工程实践，但 Redis 一致性、复杂故障处理仍需要面试验证。</p><button class="secondary full" data-nav="job">用这份简历对照 JD →</button></section>
      <section class="resume-next-action"><span>${svgIcon('target',16)}</span><div><b>下一步最有价值</b><p>直接进入简历模式面试，把“写在简历上的能力”转成真实回答证据。</p></div><button class="primary" data-nav="interview">开始面试 →</button></section>
    </aside>
  </div>`;
}

function loadJobPrepRecords(){ return S.jobPrep.records||[]; }
function currentJobPrep(){ return loadJobPrepRecords().find(x=>x.id===S.jobPrep.selectedId)||loadJobPrepRecords()[0]||null; }
function prepBadge(status){ return status==='ready'?'<span class="prep-status ready">分析完成</span>':'<span class="prep-status processing">分析中</span>'; }

function jobPrepList(){
  const all=loadJobPrepRecords();
  const q=(S.jobPrep.query||'').trim().toLowerCase();
  const records=all.filter(x=>(S.jobPrep.filter==='all'||x.status===S.jobPrep.filter)&&(!q||`${x.company} ${x.role} ${x.summary}`.toLowerCase().includes(q)));
  const cards=records.map(x=>`<article class="prep-record-card" data-prep-open="${x.id}" tabindex="0">
    <div class="prep-record-top"><div class="prep-record-company"><span>${svgIcon('briefcase',16)}</span><b>${esc(x.company)}</b></div>${prepBadge(x.status)}</div>
    <h3>${esc(x.role)}</h3><p>${esc(x.summary)}</p>
    <div class="prep-record-metrics"><div><span>匹配度</span><strong class="${x.match<40?'risk-score':''}">${x.match}%</strong></div><div><span>高危区域</span><strong class="risk-count">${x.risks}</strong></div><div><span>简历</span><strong>${x.resume?'On':'Off'}</strong></div></div>
    <div class="prep-record-foot"><span>${svgIcon('clock',13)} ${x.created}</span><button class="prep-delete" data-prep-delete="${x.id}" aria-label="删除记录">×</button></div>
  </article>`).join('');
  return `<div class="jd-prep-page">
    <section class="prep-list-hero"><div><span class="eyebrow">INTERVIEW COPILOT</span><h1>JD 备面</h1><p>提前准备好面试分析，面试时一键开启实时辅助。多 Agent 预测 HR 提问走向，实时给出回答建议。</p></div><button class="prep-new-btn" id="prep-new">＋ 新建面试准备</button></section>
    <section class="prep-overview-strip"><div><span>${svgIcon('briefcase',16)}</span><b>${all.length}</b><small>已保存准备</small></div><div><span>${svgIcon('check',16)}</span><b>${all.filter(x=>x.status==='ready').length}</b><small>分析完成</small></div><div><span>${svgIcon('target',16)}</span><b>${all.reduce((n,x)=>n+x.risks,0)}</b><small>高危区域</small></div><div class="prep-overview-note"><b>工作方式</b><span>岗位信息 → 多 Agent 预处理 → 匹配与风险分析 → 实时辅助</span></div></section>
    <section class="prep-toolbar"><div class="prep-filter-tabs"><button class="${S.jobPrep.filter==='all'?'active':''}" data-prep-filter="all">全部</button><button class="${S.jobPrep.filter==='ready'?'active':''}" data-prep-filter="ready">已完成</button><button class="${S.jobPrep.filter==='processing'?'active':''}" data-prep-filter="processing">进行中</button></div><label class="prep-search">⌕ <input id="prep-search" value="${esc(S.jobPrep.query)}" placeholder="搜索公司或岗位"></label></section>
    <section class="prep-record-grid">${cards||'<div class="prep-empty"><b>没有匹配的准备记录</b><span>调整筛选条件，或新建一次面试准备。</span></div>'}</section>
    <section class="prep-feature-grid"><article><span>${svgIcon('target',18)}</span><div><b>高危问题预测</b><p>结合岗位要求、简历差距和画像弱点，提前找出最可能被追问的风险区域。</p></div></article><article><span>${svgIcon('sparkles',18)}</span><div><b>答题策略树</b><p>不是给固定答案，而是提前整理“经历—证据—取舍—结果”的回答路径。</p></div></article><article><span>${svgIcon('mic',18)}</span><div><b>一键实时辅助</b><p>分析完成后可直接开启面试 Copilot，持续预测 HR 提问方向并给出回答建议。</p></div></article></section>
  </div>`;
}

function jobPrepNew(){
  return `<div class="jd-prep-page"><button class="prep-back" id="prep-back-list">‹ 返回准备列表</button>
    <section class="prep-detail-hero compact"><div><span class="eyebrow">NEW PREPARATION</span><h1>新建面试准备</h1><p>填写岗位信息后，多 Agent 会并行分析公司信息、岗位要求、简历匹配度和个人画像弱点。</p></div><span class="prep-status ${S.jobPrep.processing?'processing':'idle'}">${S.jobPrep.processing?'正在预处理':'待开始'}</span></section>
    <div class="prep-create-layout">
      <section class="prep-form-card"><div class="prep-card-title"><span>01</span><div><h2>填写岗位信息</h2><p>JD 内容越完整，后续匹配和提问预测越准确。</p></div></div>
        <div class="prep-form-grid"><div class="field"><label>目标公司</label><input id="jd-company" value="${esc(S.jobPrep.company)}" placeholder="例如：字节跳动"></div><div class="field"><label>目标岗位</label><input id="jd-role" value="${esc(S.jobPrep.targetRole)}" placeholder="例如：Python开发工程师"></div></div>
        <div class="field"><div class="field-label-row"><label>岗位 JD</label><span id="jd-count">${S.jobPrep.jd.length} 字</span></div><textarea id="jd" class="prep-jd-text" placeholder="粘贴岗位职责、任职要求、技术栈和加分项…">${esc(S.jobPrep.jd)}</textarea></div>
        <div class="prep-link-options"><label><input id="jd-use-resume" type="checkbox" ${S.jobPrep.useResume?'checked':''}><span>${svgIcon('resume',15)}<b>简历联动</b><small>对照经历生成策略树 · 141.1 KB</small></span><em>Active</em></label><label><input id="jd-use-profile" type="checkbox" ${S.jobPrep.useProfile?'checked':''}><span>${svgIcon('user',15)}<b>画像联动</b><small>引入 1 个领域数据及 13 个弱点标记</small></span><em>Active</em></label></div>
        <button class="prep-process-btn" id="prep-process" ${S.jobPrep.processing?'disabled':''}>${S.jobPrep.processing?'<i class="prep-spinner"></i> 多 Agent 正在并行分析…':'开始多 Agent 预处理 →'}</button>
      </section>
      <aside class="prep-decision-card"><div class="prep-decision-head"><span>决策面板</span><b>面试辅助状态</b><em>${S.jobPrep.processing?'分析中':'待开始'}</em></div>
        <div class="prep-steps"><div class="done"><i>${svgIcon('check',13)}</i><span>01</span><div><b>填写岗位信息</b><p>JD 内容已够用。</p></div></div><div class="${S.jobPrep.processing?'active':''}"><i>${S.jobPrep.processing?'<span class="prep-spinner tiny"></span>':svgIcon('sparkles',13)}</i><span>02</span><div><b>多 Agent 预处理</b><p>${S.jobPrep.processing?'正在并行分析公司信息、JD 要求和简历匹配度…':'等待开始分析。'}</p></div></div><div><i>${svgIcon('mic',13)}</i><span>03</span><div><b>开始面试辅助</b><p>策略树和风险分析完成后可开始。</p></div></div></div>
        <div class="prep-mini-stats"><div><span>简历</span><b>${S.jobPrep.useResume?'On':'Off'}</b></div><div><span>画像领域</span><b>${S.jobPrep.useProfile?'1':'0'}</b></div><div><span>弱点</span><b>${S.jobPrep.useProfile?'13':'0'}</b></div><div><span>JD 长度</span><b>${S.jobPrep.jd.length||'—'}</b></div></div>
      </aside>
    </div>
  </div>`;
}

function jobPrepDetail(){
  const x=currentJobPrep();
  const strengths=(x.strengths||[]).map(s=>`<div class="prep-strength-row"><span>${svgIcon('check',13)}</span><div><b>${esc(s[0])}</b><p>${esc(s[1])}</p></div></div>`).join('');
  const risks=(x.riskItems||[]).map((s,i)=>`<div class="prep-risk-row ${i< x.risks?'high':''}"><span>${i< x.risks?'!':'·'}</span><div><b>${esc(s[0])}</b><p>${esc(s[1])}</p></div><em>${esc(s[2])}</em></div>`).join('');
  const qs=(x.questions||[]).map((q,i)=>`<article class="prep-question-card ${i<Math.min(2,x.risks)?'danger':''}"><div><span>${i<Math.min(2,x.risks)?'高风险':'高概率'}</span><code>${esc(q[0])}</code></div><h3>${esc(q[1])}</h3><p>${i===0?'回答时优先明确本人职责、技术决策与量化结果。':i===1?'避免只背技术概念，要把方案和当前项目经历连接起来。':'准备可迁移能力和岗位动机的解释链。'}</p></article>`).join('');
  const strategy=(x.strategy||[]).map((s,i)=>`<div class="prep-strategy-node"><span>${String(i+1).padStart(2,'0')}</span><div><b>${esc(s)}</b><p>${i===0?'先建立可信项目上下文。':i===1?'主动处理岗位与简历之间最明显的差距。':i===2?'用可核验的工程证据降低风险。':'遇到能力边界时保持真实并给出验证路径。'}</p></div></div>`).join('');
  return `<div class="jd-prep-page"><button class="prep-back" id="prep-back-list">‹ 返回准备列表</button>
    <div class="prep-detail-layout">
      <main class="prep-detail-main">
        <section class="prep-detail-hero"><div><span class="eyebrow">INTERVIEW PREPARATION</span><h1>面试 Copilot</h1><p>查看 Copilot 的分析结果，准备好后点击“开始面试辅助”进入实时模式。</p></div><div class="prep-detail-actions"><button class="ghost" id="prep-save">保存记录</button><button class="ghost" id="prep-assess">开始岗位面试</button><button class="prep-live-btn" id="prep-live">开始面试辅助 →</button></div></section>
        <section class="prep-target-card"><div><span>目标公司</span><b>${esc(x.company)}</b></div><div><span>目标岗位</span><b>${esc(x.role)}</b></div><div class="prep-target-score"><span>匹配度</span><strong class="${x.match<40?'risk-score':''}">${x.match}%</strong></div><div><span>高危区域</span><strong class="risk-count">${x.risks}</strong></div></section>
        <section class="prep-linked-card"><div class="prep-linked-row"><span class="prep-link-icon resume">${svgIcon('resume',15)}</span><div><b>简历联动</b><p>对照经历生成策略树 · ${esc(x.resumeSize||'141.1 KB')}</p></div><em>ACTIVE</em></div><div class="prep-linked-row"><span class="prep-link-icon profile">${svgIcon('user',15)}</span><div><b>画像联动</b><p>引入 ${x.profileDomains||1} 个领域数据及 ${x.weaknessCount||0} 个弱点标记</p></div><em>ACTIVE</em></div></section>
        <section class="prep-analysis-banner"><div><span>${svgIcon('sparkles',16)} 多 Agent 分析结论</span><h2>${esc(x.company)} · ${esc(x.role)}</h2><p>${esc(x.summary)}</p></div><div><span class="prep-match-chip">匹配度 ${x.match}%</span><span class="prep-risk-chip">${x.risks} 个高危区域</span></div></section>
        <div class="prep-analysis-columns"><section class="prep-analysis-card strengths"><div class="prep-card-head"><div><span>匹配分析</span><h2>已有优势 / 可迁移能力</h2></div><span class="badge verified">可主动发挥</span></div>${strengths}</section><section class="prep-analysis-card risks"><div class="prep-card-head"><div><span>风险分析</span><h2>高危区域</h2></div><span class="badge gap">${x.risks} 项</span></div>${risks}</section></div>
        <section class="prep-question-section"><div class="prep-card-head"><div><span>HR 提问预测</span><h2>最可能出现的提问走向</h2><p>根据岗位要求、简历错位和画像弱点按优先级排序。</p></div><span class="badge blue">多 Agent 汇总</span></div><div class="prep-question-grid">${qs}</div></section>
        <section class="prep-strategy-section"><div class="prep-card-head"><div><span>回答策略树</span><h2>面试时按这条路径组织回答</h2></div><span class="badge verified">Ready</span></div><div class="prep-strategy-list">${strategy}</div></section>
      </main>
      <aside class="prep-decision-card sticky"><div class="prep-decision-head"><span>决策面板</span><b>面试辅助状态</b><em>已就绪</em></div>
        <div class="prep-steps"><div class="done"><i>${svgIcon('check',13)}</i><span>01</span><div><b>填写岗位信息</b><p>JD 内容已够用。</p></div></div><div class="done"><i>${svgIcon('check',13)}</i><span>02</span><div><b>多 Agent 预处理</b><p>公司、岗位、简历和画像分析完成。</p></div></div><div class="active"><i>${svgIcon('mic',13)}</i><span>03</span><div><b>开始面试辅助</b><p>策略树和风险分析完成后可开始。</p></div></div></div>
        <div class="prep-mini-stats"><div><span>简历</span><b>On</b></div><div><span>画像领域</span><b>${x.profileDomains||1}</b></div><div><span>弱点</span><b>${x.weaknessCount||0}</b></div><div><span>JD 长度</span><b>${x.jdLength||'—'}</b></div></div>
        <button class="ghost full" id="prep-assess-2">开始岗位面试</button><button class="prep-live-btn full" id="prep-live-2">${svgIcon('mic',14)} 开始面试辅助</button><button class="prep-list-link" id="prep-back-list-2">返回列表</button>
      </aside>
    </div>
  </div>`;
}

function job(){
  if(S.jobPrep.screen==='new') return jobPrepNew();
  if(S.jobPrep.screen==='detail') return jobPrepDetail();
  if(S.jobPrep.screen==='live') return jobLive();
  return jobPrepList();
}

function jobLive(){
  const x=currentJobPrep();
  const listening=S.jobPrep.liveListening;
  return `<div class="copilot-live-page">
    <header class="copilot-live-top"><div class="copilot-live-brand"><span>${svgIcon('sparkles',18)}</span><b>面试 Copilot</b><em><i></i> 已连接</em><small>${esc(x.company)} · ${esc(x.role)}</small></div><div class="copilot-live-actions"><button id="live-toggle">${svgIcon('mic',14)} ${listening?'暂停录音':'开始录音'}</button><button id="live-exit">结束辅助</button></div></header>
    <div class="copilot-live-grid"><main class="copilot-stage"><div class="copilot-analysis-strip"><section><span>${svgIcon('sparkles',13)} 重新引导</span><p>${listening?'当前建议：先说明项目背景与本人职责，再进入技术决策，避免直接堆技术名词。':'等待对话自动分析…'}</p></section><section><span>${svgIcon('target',13)} HR 行为建模</span><p>${listening?'当前提问节奏偏项目深挖，下一步大概率追问个人贡献和技术取舍。':'数据采集中（0/3 轮）'}</p></section></div>
      ${listening?`<div class="copilot-dialog"><span>HR</span><p>请你介绍一下自己最有代表性的项目，以及你在里面具体负责什么？</p></div><div class="copilot-stage-empty active"><div class="mic-orb">${svgIcon('mic',24)}</div><b>AI COPILOT 正在监听</b><p>已结合“${esc(x.company)} · ${esc(x.role)}”的风险分析持续预测下一问。</p></div>`:`<div class="copilot-stage-empty"><div class="mic-orb">${svgIcon('mic',24)}</div><b>AI COPILOT 模式已开启</b><p>点击右上角“开始录音”，系统会根据 HR 对话实时给出回答建议。</p></div>`}
      <footer class="copilot-composer"><span>HR</span><input placeholder="也可以手动输入 HR 的问题…"><button>${svgIcon('sparkles',14)}</button></footer>
    </main><aside class="copilot-console"><div class="console-head"><span>CONSOLE UPLINK</span><i></i><i></i><i></i></div><section class="console-item"><span>${svgIcon('check',14)} 回答评价</span><p>${listening?'先给结论，再补本人职责和结果数据。岗位匹配度较低时，不要回避技术栈差异，要主动解释可迁移能力。':'等待第一轮回答…'}</p></section><section class="console-item"><span>${svgIcon('user',14)} 当前专家</span><p>${listening?'PROJECT · BACKEND':'—'}</p></section><section class="console-item"><span>${svgIcon('sparkles',14)} 核心要点建议</span><p>${listening?'背景 → 本人职责 → 技术取舍 → 量化结果 → 与 Python 岗位的迁移关系':'等待对话内容…'}</p></section><section class="console-item"><span>${svgIcon('clock',14)} 历史参考打样</span><p>${esc(x.strategy?.[0]||'暂无')}</p></section><section class="console-item predicted"><span>${svgIcon('target',14)} 预测追问方向</span><p>${listening?'为什么你主要做 Java，却认为自己能胜任 Python 开发？':'开始录音后实时更新'}</p></section></aside></div>
  </div>`;
}

function interviewSetup(){
  const r=role();
  const sourceMode=S.interview.sourceMode||'resume';
  const resumeMode=sourceMode==='resume';
  const jdText='负责核心服务设计、开发与性能优化，保障系统稳定性，参与缓存、数据库和微服务治理。';
  return `${pageHead('INTERVIEW WORKSPACE','面试训练','选择本轮面试依据：简历模式验证候选人经历，岗位模式验证 JD 要求。两种模式使用独立的阶段、问题和证据目标。')}
  <div class="interview-setup-page">
    <section class="interview-mode-switch">
      <button class="${resumeMode?'active':''}" data-interview-source="resume"><span>${svgIcon('resume',16)}</span><div><b>简历模式</b><small>读取已有简历，围绕项目经历与技能声明展开</small></div></button>
      <button class="${!resumeMode?'active':''}" data-interview-source="job"><span>${svgIcon('briefcase',16)}</span><div><b>岗位模式</b><small>自己填写公司、目标岗位和 JD，按岗位要求定向提问</small></div></button>
    </section>
    <div class="interview-mode-note">${resumeMode?`${svgIcon('resume',14)} 以当前简历为主线，系统会优先验证项目经历、技术声明和待验证能力。`:`${svgIcon('briefcase',14)} 岗位模式由你自己填写目标信息；JD 越完整，后续能力映射和问题越有针对性。`}</div>

    <section class="interview-material-card section">
      <div class="interview-card-head"><div><span>${resumeMode?'简历资料':'岗位资料'}</span><h2>${resumeMode?'使用当前简历开始面试':'填写本次目标岗位'}</h2><p>${resumeMode?'简历是本轮提问主线，目标岗位用于调整问题重点。':'公司可选，目标岗位必填；建议粘贴完整 JD 以生成更准确的能力重点。'}</p></div><span class="badge ${resumeMode?'verified':'blue'}">${resumeMode?'简历已连接':'手动填写'}</span></div>
      ${resumeMode?`
        <div class="interview-resume-row"><div class="interview-file-check">✓</div><div class="file-icon">PDF</div><div><b>${esc(S.resume.fileName||'张同学_Java后端简历.pdf')}</b><span>当前简历 · 用于项目深挖与能力声明核验</span></div><button class="ghost" data-nav="resume">简历管理 →</button></div>
        <div class="interview-material-grid">
          <div class="field"><label>目标岗位</label><div class="interview-static-field"><span>${svgIcon('briefcase',15)}</span><b>${r.name}</b><button data-nav="job">调整岗位</button></div></div>
          <div class="field"><label>岗位标准</label><div class="interview-static-field"><span>${svgIcon('target',15)}</span><b>${S.jdReady?'已完成 JD 能力映射':'已载入岗位能力模板'}</b><button data-nav="job">${S.jdReady?'查看映射':'完善 JD'}</button></div></div>
        </div>
        <div class="field interview-jd-preview"><div class="field-label-row"><label>JD（可选）</label><button class="text-link" data-nav="job">进入 JD 备面 →</button></div><div class="interview-jd-text">${jdText}</div></div>
        <div class="interview-context-tags"><span>${svgIcon('resume',13)} 简历已读取</span><span>${svgIcon('briefcase',13)} ${r.name}</span><span>${svgIcon('target',13)} 6 个能力维度</span><span>${svgIcon('check',13)} 证据审计已开启</span></div>
      `:`
        <div class="interview-job-form">
          <div class="interview-material-grid">
            <div class="field"><label>公司（可选）</label><input id="interview-company" value="${esc(S.interview.company)}" placeholder="例如：字节跳动"></div>
            <div class="field"><label>目标岗位 <em>*</em></label><input id="interview-target-role" value="${esc(S.interview.targetRole)}" placeholder="例如：Java 后端开发工程师"></div>
          </div>
          <div class="field"><div class="field-label-row"><label>目标岗位 JD <em>*</em></label><span class="jd-count" id="interview-jd-count">${(S.interview.jobJD||'').length} 字</span></div><textarea id="interview-job-jd" class="interview-job-jd" placeholder="粘贴完整 JD，包括岗位职责、任职要求、业务背景和技术栈。">${esc(S.interview.jobJD)}</textarea></div>
          <div class="interview-job-hints"><span><b>至少 50 字</b> 内容太短无法形成有效岗位能力映射</span><span><b>保留原始描述</b> 方便后续追溯为什么问这道题</span><span><b>职责尽量完整</b> 能更准确识别重点与加分项</span></div>
          <label class="interview-use-resume"><input id="interview-use-resume" type="checkbox" ${S.interview.useResume!==false?'checked':''}><span>${svgIcon('resume',14)} 同时结合当前简历生成针对性问题</span><small>${esc(S.resume.fileName||'张同学_Java后端简历.pdf')}</small></label>
        </div>
      `}
    </section>

    <section class="interview-flow-card section">
      <div class="interview-card-head"><div><span>${resumeMode?'简历驱动流程':'JD 驱动流程'}</span><h2>${resumeMode?'简历模式四阶段':'岗位模式四阶段'}</h2><p>${resumeMode?'从候选人经历出发，逐步核验项目事实和能力声明。':'从岗位要求出发，先判断岗位理解，再逐项验证核心要求和岗位情景。'}</p></div><span class="badge verified">可开始</span></div>
      <div class="interview-flow-steps">
        ${resumeMode?`
        <div><span>01</span><div><b>自我介绍</b><p>建立候选人画像，观察表达、信息组织与岗位动机。</p></div><i>${svgIcon('user',16)}</i></div>
        <div><span>02</span><div><b>项目深挖</b><p>围绕简历项目验证本人职责、技术取舍、约束与量化结果。</p></div><i>${svgIcon('file',16)}</i></div>
        <div><span>03</span><div><b>能力考察</b><p>结合 JD 和待验证能力进行技术、业务与情景问题。</p></div><i>${svgIcon('target',16)}</i></div>
        <div><span>04</span><div><b>总结反馈</b><p>完成覆盖检查，生成岗位匹配度、证据报告和下一步训练建议。</p></div><i>${svgIcon('check',16)}</i></div>
        `:`
        <div><span>01</span><div><b>岗位理解</b><p>确认你是否真正理解 JD 中最重要的职责、优先级和业务目标。</p></div><i>${svgIcon('briefcase',16)}</i></div>
        <div><span>02</span><div><b>核心要求验证</b><p>围绕高优先级要求核验真实经历、技术取舍和量化结果。</p></div><i>${svgIcon('check',16)}</i></div>
        <div><span>03</span><div><b>岗位情景任务</b><p>把 JD 要求放进真实工作场景，观察判断顺序、止损和边界意识。</p></div><i>${svgIcon('target',16)}</i></div>
        <div><span>04</span><div><b>匹配收口</b><p>对照岗位要求确认已满足、待验证和入职后需要补齐的能力。</p></div><i>${svgIcon('sparkles',16)}</i></div>
        `}
      </div>
      <div class="interview-ready-strip"><div><span>开始条件</span><b>${resumeMode?'4 / 4 已满足':'填写岗位信息后即可开始'}</b></div><div class="ready-checks">${resumeMode?'<span>✓ 简历</span><span>✓ 目标岗位</span><span>✓ 能力标准</span><span>✓ 证据审计</span>':'<span>目标岗位</span><span>岗位 JD</span><span>能力映射</span><span>可选简历</span>'}</div></div>
      <button class="primary big full interview-launch" id="interview-start">${resumeMode?'开始简历面试':'分析岗位并开始面试'} →</button>
      <p class="interview-launch-tip">开始后将进入四阶段问答，系统会根据回答证据决定是否继续追问。</p>
    </section>

    <section class="interview-recent-card section">
      <div class="section-head"><div><h2>最近面试</h2><p class="muted">继续上次训练，或查看最近一次评估结果。</p></div><button class="text-link" data-nav="history">查看全部 →</button></div>
      <div class="interview-recent-list">
        <button data-nav="report"><span class="recent-type blue">岗</span><div><b>Java 后端岗位面试</b><p>今天 18:10 · 岗位模式 · 覆盖率 81%</p></div><strong>79</strong><i>查看报告 →</i></button>
        <button data-nav="history"><span class="recent-type green">简</span><div><b>Java 项目深挖面试</b><p>09-06 21:35 · 简历模式 · 项目证据补充</p></div><strong>82</strong><i>查看记录 →</i></button>
      </div>
    </section>
  </div>`;
}

function evidenceTargets(index){
  return [
    ['业务目标','本人职责','项目结果'],
    ['备选方案','选择依据','验证方法','量化结果'],
    ['定位顺序','指标工具','判断依据','止损动作'],
    ['复盘结论','改进行动','风险意识']
  ][index]||['事实','行动','结果'];
}
function detectGap(text){
  const t=text.toLowerCase();
  const mentionsIndex=t.includes('联合索引')||t.includes('索引');
  if(!mentionsIndex) return null;
  const missing=[];
  if(!/字段|顺序|选择性|最左/.test(t)) missing.push('字段顺序与选择依据');
  if(!/explain|执行计划|扫描行/.test(t)) missing.push('EXPLAIN 前后对比');
  if(!/ms|毫秒|420|95|性能|耗时/.test(t)) missing.push('量化性能结果');
  if(!/失败|重试|一致性|补偿|边界/.test(t)) missing.push('异常与边界');
  return missing.length?missing:null;
}

function jobInterviewQuestions(r=role()){
  const banks={
    'java-backend':[
      {stage:'岗位理解',text:'结合这份 JD，你认为这个 Java 后端岗位最核心的三项职责是什么？如果你入职，前 30 天会优先熟悉和解决什么？',competency:'delivery-quality'},
      {stage:'核心要求验证',text:'JD 强调数据库性能优化、Redis 缓存与稳定性。请选一项你真正做过的经历，说明问题、方案取舍、验证方法和量化结果。',competency:'backend-depth'},
      {stage:'岗位情景任务',text:'你入职后负责的核心接口 P95 从 180ms 升到 2.8s，同时 Redis 命中率下降。请按前 10 分钟的处理顺序说明如何止损、定位和验证。',competency:'reliability'},
      {stage:'匹配收口',text:'对照这份 JD，哪些要求你已经有直接证据，哪些仍然需要补齐？如果被录用，你会如何在前 30 天补齐最关键的一项？',competency:'ownership'}
    ],
    'ai-algorithm':[
      {stage:'岗位理解',text:'结合这份 JD，你认为算法岗位最核心的产出是什么？请区分模型效果、数据闭环和工程交付三类目标。',competency:'model-reasoning'},
      {stage:'核心要求验证',text:'JD 要求模型训练、调优和效果评估。请讲一次真实经历：你如何建立 baseline、设计数据切分和指标，并判断改动是否有效？',competency:'data-experiment'},
      {stage:'岗位情景任务',text:'模型上线后效果下降，同时延迟和推理成本上升。你会如何判断优先级、定位原因并设计回滚或降级方案？',competency:'ml-engineering'},
      {stage:'匹配收口',text:'对照这份 JD，哪些要求你已有可复现证据，哪些仍需补齐？如果入职，前 30 天最需要建立哪一套实验或工程习惯？',competency:'communication'}
    ],
    'product-manager':[
      {stage:'岗位理解',text:'结合这份 JD，你认为这个产品岗位最重要的业务目标、用户问题和跨团队责任分别是什么？',competency:'problem-definition'},
      {stage:'核心要求验证',text:'JD 强调产品规划和持续迭代。请讲一个真实功能：你如何定义问题、比较方案优先级，并用数据验证结果？',competency:'metrics-experiment'},
      {stage:'岗位情景任务',text:'上线前一周研发资源突然减少一半，同时核心客户要求插入紧急需求。你会如何重新排优先级并推动团队达成一致？',competency:'execution'},
      {stage:'匹配收口',text:'对照这份 JD，哪些要求你可以用真实案例证明，哪些还只是认知层面的准备？入职后最先补哪一项？',competency:'communication'}
    ]
  };
  return banks[r.id]||[
    {stage:'岗位理解',text:`结合这份 JD，请说明你理解的 ${r.name} 核心职责、优先级和业务目标。`,competency:(r.competencies[0]||{}).id},
    {stage:'核心要求验证',text:'请选择一个高优先级岗位要求，用真实经历说明你的行动、取舍和可核验结果。',competency:(r.competencies[0]||{}).id},
    {stage:'岗位情景任务',text:'如果入职后遇到一个高优先级异常任务，你会如何判断、处理并验证结果？',competency:(r.competencies[1]||r.competencies[0]||{}).id},
    {stage:'匹配收口',text:'对照这份 JD，总结你已经满足的要求、待补齐的要求和入职后的补强计划。',competency:(r.competencies[2]||r.competencies[0]||{}).id}
  ];
}

function currentInterviewQuestions(){
  if(S.interview.backendQuestions?.length) return S.interview.backendQuestions;
  return S.interview.sourceMode==='job'?jobInterviewQuestions(role()):(role().questions||[]);
}

function questionCompetency(q){ return q?.competency_id||q?.competency||''; }
function questionTargets(q,index){ return q?.evidence_targets?.length?q.evidence_targets:(S.interview.sourceMode==='job'?jobEvidenceTargets(index):evidenceTargets(index)); }
function currentInterviewJobAnalysis(){
  const id=S.interview.jobAnalysisId;
  if(!id)return null;
  return (S.jobPrep.records||[]).find(x=>x.id===id)?.raw||null;
}

function currentJobSignals(){
  const analysis=currentInterviewJobAnalysis();
  const rows=analysis?.core_requirements||[];
  if(rows.length) return rows.map((s,i)=>({
    id:s.id||`jd-signal-${i+1}`,
    quote:s.quote||'',
    priority:s.priority||'medium',
    competency_id:s.competency_id||s.competency||'',
    competency:s.competency_id||s.competency||'',
    competency_name:s.competency_name||'',
    reason:s.reason||''
  }));
  return (role().jdSignals||[]).map((s,i)=>({...s,id:s.id||`role-signal-${i+1}`,competency_id:s.competency_id||s.competency||'',competency:s.competency_id||s.competency||''}));
}

function signalForQuestion(q,index=0){
  const signals=currentJobSignals();
  const cid=questionCompetency(q);
  return signals.find(s=>(s.competency_id||s.competency)===cid)||signals[Math.min(index,Math.max(0,signals.length-1))]||signals[0]||{};
}

function jobEvidenceTargets(index){
  return [
    ['职责理解','优先级判断','业务目标','入职计划'],
    ['真实经历','方案取舍','验证方法','量化结果'],
    ['止损顺序','定位工具','判断依据','恢复验证'],
    ['已满足要求','待补能力','补强计划','岗位动机']
  ][index]||['事实','判断','行动','结果'];
}

function jobInterview(){
  const r=role();
  const questions=currentInterviewQuestions();
  const idx=Math.min(S.interview.index,questions.length-1);
  const q=questions[idx]||{};
  const signals=currentJobSignals();
  const activeSignal=signalForQuestion(q,idx);
  const targets=questionTargets(q,idx);
  const comp=(r.competencies||[]).find(c=>c.id===questionCompetency(q))||{};
  const answered=S.interview.answers.filter(a=>a&&a!=='[SKIPPED]').length;
  const targetRole=S.interview.targetRole||r.name;
  const company=S.interview.company||'目标公司';
  const jdText=S.interview.jobJD||S.jobPrep.jd||'';
  const answerValue=(S.interview.drafts&&S.interview.drafts[idx]!==undefined)?S.interview.drafts[idx]:'';
  const stages=questions.map((x,i)=>`<div class="stage ${i<idx?'done':i===idx?'active':''}"><span>${i+1}</span><b>${x.stage}</b></div>`).join('');
  const previous=S.interview.answers.slice(0,idx).map((a,i)=>a?`<div class="job-prev-row"><span>0${i+1}</span><div><b>${questions[i].stage}</b><p>${esc(a.replace(/^补充：/,'').slice(0,105))}${a.length>105?'…':''}</p></div><em>${S.interview.skipped?.[i]?'待验证':'已完成'}</em></div>`:'').join('');
  const composer=(placeholder,tip)=>`<div class="job-answer-box"><div class="live-answer-head"><label for="answer">你的回答</label><span id="answer-count">${answerValue.length} 字 · 建议 80–300 字</span></div><textarea id="answer" placeholder="${placeholder}">${esc(answerValue)}</textarea><div class="live-answer-footer"><span id="draft-state">${tip}</span><div><button class="text-link" id="interview-skip">稍后回答</button><button class="primary" id="answer-submit">${S.interview.sessionId?'提交并继续':'生成岗位匹配报告'} →</button></div></div></div>`;

  if(S.interview.gap){
    return `${pageHead('JOB EVIDENCE GAP','岗位要求证据不足','这次追问来自 JD 的高优先级要求，不是按简历项目模板机械追问。','<span class="badge gap">JD 驱动追问</span>')}<section class="job-gap-shell"><div class="stagebar">${stages}</div><div class="job-gap-grid"><section class="card"><div class="job-source-quote"><span>对应岗位要求</span><b>“${esc(activeSignal.quote||'岗位核心能力要求')}”</b></div><div class="notice warning"><b>为什么继续追问</b><span>${esc(S.interview.lastEvidence?.incomplete?'当前回答尚未完整，系统先继续补问，不直接按低分处理。':'当前回答还缺少足够的可核验证据，因此继续针对缺口追问。')}</span></div><div class="gap-grid">${S.interview.gap.map(x=>`<div class="gap-item"><span>仍缺证据</span><b>${esc(evidenceLabel(x))}</b></div>`).join('')}</div><div class="field"><label>岗位定向追问</label><div class="question-inline">${esc(S.interview.followupQuestion?.text||'请把这段经历补完整：为什么这样设计、如何确认方案生效、优化前后有什么量化变化，以及失败时如何处理？')}</div><textarea id="follow-answer" placeholder="继续补充真实经历和可核验证据…"></textarea></div><button class="primary" id="follow-submit">补充岗位证据并继续 →</button></section><aside class="card"><div class="section-head"><h2>岗位要求覆盖</h2><span class="badge partial">部分满足</span></div><div class="job-requirement-list">${signals.map((s,i)=>`<div><span>${i+1}</span><div><b>${esc(s.quote)}</b><small>${esc(s.priority)}优先级</small></div><em>${s.id===activeSignal.id?'当前追问':'待后续验证'}</em></div>`).join('')}</div></aside></div></section>`;
  }

  const requirementList=signals.map((s,i)=>`<div class="job-req ${s.id===activeSignal.id?'active':''}"><span>0${i+1}</span><div><b>${esc(s.quote)}</b><small>${esc(s.priority)}优先级 · ${esc(s.competency_name||(r.competencies||[]).find(c=>c.id===(s.competency_id||s.competency))?.name||'岗位能力')}</small></div><em>${s.id===activeSignal.id?'当前重点':'待验证'}</em></div>`).join('');
  const acquiredSlots=new Set((S.interview.lastEvidence?.acquired||[]).map(x=>x.slot));
  const evidenceList=targets.map(t=>`<div class="${acquiredSlots.has(t)?'done':''}"><i></i><span>${esc(evidenceLabel(t))}</span><em>${acquiredSlots.has(t)?'已获得':'待回答'}</em></div>`).join('');
  let main='',aside='',stageClass='job-understand-stage';
  if(idx===0){
    main=`<main class="job-main-card job-understand-scene"><div class="job-brief-head"><div><span>JD ROLE BRIEF</span><h2>${esc(targetRole)}</h2><p>${esc(company)} · ${jdText.length} 字岗位描述 · ${signals.length} 条核心要求已识别</p></div><div class="job-fit-chip"><strong>${Math.max(68,avg(r)-8)}%</strong><span>当前准备度</span></div></div><div class="job-priority-board">${signals.map((s,i)=>`<div><span>0${i+1}</span><b>${s.quote}</b><small>${s.priority}优先级</small></div>`).join('')}</div><div class="job-stage-question"><span>先看你是否真正读懂岗位</span><h2>${q.text}</h2></div>${composer('不要先介绍项目。先基于 JD 回答：这个岗位要解决什么问题、优先级怎么排、你入职后先做什么…','这一阶段验证岗位理解，不以项目经历为主线')}</main>`;
    aside=`<aside class="job-side-stack"><section class="job-side-card"><div class="job-side-head"><span>岗位输入</span><b>JD 已锁定</b></div><div class="job-context-kv"><div><span>公司</span><b>${esc(company)}</b></div><div><span>岗位</span><b>${esc(targetRole)}</b></div><div><span>岗位要求</span><b>${signals.length} 条</b></div><div><span>结合简历</span><b>${S.interview.useResume?'是':'否'}</b></div></div></section><section class="job-side-card"><div class="job-side-head"><span>本阶段证据</span><b>0 / ${targets.length}</b></div><div class="live-evidence-targets">${evidenceList}</div></section></aside>`;
  }else if(idx===1){
    const s=activeSignal;
    main=`<main class="job-main-card job-requirement-scene"><div class="job-source-quote large"><span>本题直接来源于 JD</span><b>“${esc(s.quote||'岗位核心能力要求')}”</b><small>${esc(s.priority||'high')}优先级 · ${esc(s.competency_name||comp.name||'核心能力')}</small></div><div class="job-stage-question"><span>${esc(q.stage||'核心要求验证')}</span><h2>${esc(q.text)}</h2></div><div class="job-evidence-frame"><div><span>01</span><b>真实问题</b><small>当时遇到了什么约束</small></div><div><span>02</span><b>方案取舍</b><small>为什么选这个方案</small></div><div><span>03</span><b>验证结果</b><small>数据如何证明有效</small></div><div><span>04</span><b>边界处理</b><small>失败时如何兜底</small></div></div>${composer('用一段真实经历回答，并给出方案选择、验证数据和失败边界…','提交后会按岗位证据槽位检查是否需要继续追问')}</main>`;
    aside=`<aside class="job-side-stack"><section class="job-side-card"><div class="job-side-head"><span>JD 要求覆盖</span><b>${idx}/${signals.length}</b></div><div class="job-requirement-list">${requirementList}</div></section>${S.interview.useResume?`<section class="job-side-card resume-cross"><div class="job-side-head"><span>简历交叉验证</span><b>已开启</b></div><p>简历中发现 MySQL 索引优化与 Redis 使用经历，但技术取舍和边界仍需当前回答确认。</p><span class="badge partial">部分证据</span></section>`:''}</aside>`;
  }else if(idx===2){
    const scenario=r.id==='java-backend'?['核心接口 P95','2.8s ↑','Redis 命中率','61% ↓','流量','正常']:r.id==='ai-algorithm'?['线上效果','-8.4%','P95 延迟','+42%','成本','+31%']:['研发资源','-50%','紧急需求','1 项','上线时间','7 天'];
    main=`<main class="job-main-card job-task-scene"><div class="job-task-banner"><div><span class="incident-dot"></span><div><span>岗位实战任务</span><b>${q.stage}</b></div></div><div class="job-task-metrics"><span>${scenario[0]} <b>${scenario[1]}</b></span><span>${scenario[2]} <b>${scenario[3]}</b></span><span>${scenario[4]} <b>${scenario[5]}</b></span></div></div><div class="job-stage-question"><span>假设你已经入职并负责这个岗位</span><h2>${q.text}</h2></div><div class="job-action-lane"><div><span>01</span><b>先判断</b><small>明确影响范围与优先级</small></div><i>→</i><div><span>02</span><b>先止损</b><small>控制风险避免扩大</small></div><i>→</i><div><span>03</span><b>再定位</b><small>用证据验证假设</small></div><i>→</i><div><span>04</span><b>恢复验证</b><small>确认系统或业务恢复</small></div></div>${composer('按真实工作顺序回答，不要只列知识点；说明你先做什么、为什么、如何判断下一步…','岗位情景题重点验证决策顺序和边界，而不是背标准答案')}</main>`;
    aside=`<aside class="job-side-stack"><section class="job-side-card"><div class="job-side-head"><span>当前岗位能力</span><b>${comp.name||questionCompetency(q)}</b></div><div class="live-ability-score"><strong>${comp.score||'—'}</strong><div><span>当前画像参考</span><div class="progress"><i style="width:${pct(comp.score)}%"></i></div></div></div><p>${comp.definition||'通过岗位情景任务补充能力证据。'}</p></section><section class="job-side-card"><div class="job-side-head"><span>本题证据</span><b>0 / ${targets.length}</b></div><div class="live-evidence-targets">${evidenceList}</div></section></aside>`;
  }else{
    const covered=Math.min(signals.length,Math.max(1,answered));
    main=`<main class="job-main-card job-fit-scene"><div class="job-fit-overview"><div><span>岗位要求覆盖检查</span><h2>${covered} / ${signals.length} 条核心要求已有回答证据</h2><p>最后不是再问一个项目题，而是让你对照 JD 明确自己的真实匹配边界。</p></div><div class="summary-ring"><strong>${Math.round((covered/Math.max(1,signals.length))*100)}%</strong><span>要求覆盖</span></div></div><div class="job-match-matrix">${signals.map((s,i)=>`<div><span>${i<covered?'✓':'○'}</span><div><b>${s.quote}</b><small>${(r.competencies||[]).find(c=>c.id===s.competency)?.name||'岗位能力'}</small></div><em>${i<covered?'已有证据':'待验证'}</em></div>`).join('')}</div><div class="job-stage-question"><span>匹配收口</span><h2>${q.text}</h2></div>${composer('直接对照 JD 回答：哪些要求已有证据、哪些还缺、你准备如何补齐…','提交后生成岗位匹配度、要求覆盖率和证据审计报告')}</main>`;
    aside=`<aside class="job-side-stack"><section class="job-side-card"><div class="job-side-head"><span>报告预览</span><b>JD 驱动</b></div><div class="preview-kpis"><div><span>岗位匹配</span><strong>${avg(r)}%</strong></div><div><span>要求覆盖</span><strong>${Math.round((covered/Math.max(1,signals.length))*100)}%</strong></div><div><span>待验证</span><strong>${Math.max(0,signals.length-covered)}</strong></div></div></section><section class="job-side-card"><div class="job-side-head"><span>与简历模式不同</span><b>岗位要求优先</b></div><p>本轮结论以 JD 要求是否被证据覆盖为主；简历仅在开启交叉验证时提供辅助背景。</p></section></aside>`;
  }

  return `${pageHead('JOB LIVE SESSION',`${idx+1}. ${q.stage}`,'岗位模式以 JD 要求为主线，阶段、问题和证据目标都与简历模式独立。',`<span class="badge blue">岗位模式 · JD 驱动</span>`)}<section class="job-live-shell ${stageClass}"><div class="job-live-toolbar"><div><span class="live-dot"></span><b>岗位定向面试</b><span>${esc(company)} · ${esc(targetRole)}</span><span>阶段 ${idx+1} / ${questions.length}</span></div><div><button class="ghost" id="interview-save">${svgIcon('file',14)} 保存草稿</button><button class="danger-ghost" id="interview-end">结束面试</button></div></div><div class="live-stage-wrap"><div class="stagebar job-stagebar">${stages}</div><div class="live-stage-line"><i style="width:${Math.round(((idx+1)/questions.length)*100)}%"></i></div></div><div class="job-live-grid">${main}${aside}</div>${previous?`<section class="job-prev-panel"><div class="section-head"><div><h2>前序岗位回答</h2><p class="muted">后续阶段会承接前面的岗位判断，而不是重新从简历项目开始问。</p></div><span class="badge verified">${answered} 个阶段已回答</span></div><div>${previous}</div></section>`:''}</section>`;
}

function interview(){
  if(!S.interview.started) return interviewSetup();
  if(S.interview.sourceMode==='job') return jobInterview();
  const r=role(); const idx=S.interview.index; const qs=currentInterviewQuestions(); const q=qs[idx]||qs[0]||{};
  const stages=qs.map((x,i)=>`<div class="stage ${i<idx?'done':i===idx?'active':''}"><span>${i+1}</span><b>${x.stage}</b></div>`).join('');
  if(S.interview.gap){
    return `${pageHead('EVIDENCE GAP','发现关键证据缺口','系统不是因为回答短就直接扣分，而是先识别当前还缺哪些证据。','<span class="badge gap">继续追问</span>')}<div class="stagebar">${stages}</div><div class="grid-2"><section class="card"><div class="notice warning"><b>为什么追问</b><span>你已经提到“联合索引”，但当前证据还不足以判断技术取舍和验证质量。</span></div><div class="gap-grid">${S.interview.gap.map(x=>`<div class="gap-item"><span>缺失证据</span><b>${esc(evidenceLabel(x))}</b></div>`).join('')}</div><div class="field"><label>针对性追问</label><div class="question-inline">${esc(S.interview.followupQuestion?.text||'你当时是如何确认这个索引真正生效的？请补充字段顺序、执行计划和优化前后结果。')}</div><textarea id="follow-answer">索引字段顺序按查询条件和选择性确定。我们用 EXPLAIN 对比执行计划，热门查询从 420ms 降到 95ms。缓存删除失败时写入重试任务，避免长期不一致。</textarea></div><button class="primary" id="follow-submit">补充证据并继续 →</button></section><section class="card"><h2>当前证据台账</h2><div class="evidence-list"><div class="evidence-row"><div><b>技术方案</b><p>“通过联合索引优化 SQL”</p></div><span class="badge verified">已获得</span></div>${S.interview.gap.map(x=>`<div class="evidence-row"><div><b>${esc(evidenceLabel(x))}</b><p>当前回答中尚未找到可核验信息</p></div><span class="badge gap">缺失</span></div>`).join('')}</div></section></div>`;
  }
  const targets=questionTargets(q,idx);
  const comp=(r.competencies.find(c=>c.id===questionCompetency(q))||{});
  const compName=comp.name||questionCompetency(q);
  const answeredCount=S.interview.answers.filter(a=>a&&a!=='[SKIPPED]').length;
  const skippedCount=(S.interview.skipped||[]).filter(Boolean).length;
  const targetRole=S.interview.sourceMode==='job'?(S.interview.targetRole||r.name):r.name;
  const resumeName=S.interview.sourceMode==='job'&&S.interview.useResume===false?'本轮未使用':(S.resume.fileName||'张同学_Java后端简历.pdf');
  const defaultAnswer=idx===0?'我负责校园场地预约服务的接口设计和性能优化，主要负责预约接口、数据库查询优化和缓存方案。':idx===1&&!S.interview.resolved?'我们通过联合索引优化了 SQL。':'';
  const answerValue=(S.interview.drafts&&S.interview.drafts[idx]!==undefined)?S.interview.drafts[idx]:defaultAnswer;
  const previous=S.interview.answers.slice(0,idx).map((a,i)=>a?`<div class="live-history-item"><span>Q${i+1}</span><div><b>${(qs[i]||{}).stage||'已完成问题'}</b><p>${esc(a.replace(/^补充：/,'').slice(0,110))}${a.length>110?'…':''}</p></div><em>${S.interview.skipped?.[i]?'待验证':'已完成'}</em></div>`:'').join('');
  const answerComposer=(placeholder,tip='回答内容仅在提交后进入正式证据')=>`<div class="live-answer-wrap"><div class="live-answer-head"><label for="answer">你的回答</label><span id="answer-count">${answerValue.length} 字 · 建议 80–300 字</span></div><textarea id="answer" placeholder="${placeholder}">${esc(answerValue)}</textarea><div class="live-answer-footer"><span id="draft-state">${tip}</span><div><button class="text-link" id="interview-skip">稍后回答</button><button class="primary" id="answer-submit">${S.interview.sessionId?'提交回答并继续':idx===qs.length-1?'生成可审计报告':'提交回答并继续'} →</button></div></div></div><div class="live-skip-note">${svgIcon('check',13)} 跳过或提前结束不会自动计为低分，未完成内容会进入“待验证”。</div>`;
  const contextCard=`<section class="live-side-card context"><div class="live-side-head"><span>本轮上下文</span><b>${answeredCount}/${r.questions.length} 已完成</b></div><div class="live-context-list"><div><span>目标岗位</span><b>${esc(targetRole)}</b></div>${S.interview.company?`<div><span>目标公司</span><b>${esc(S.interview.company)}</b></div>`:''}<div><span>简历</span><b>${esc(resumeName)}</b></div><div><span>已跳过</span><b>${skippedCount} 题</b></div></div></section>`;
  const abilityCard=`<section class="live-side-card ability"><div class="live-side-head"><span>当前考察能力</span><b>${compName}</b></div><div class="live-ability-score"><strong>${comp.score||'—'}</strong><div><span>当前画像分</span><div class="progress"><i style="width:${pct(comp.score)}%"></i></div></div></div><p>${comp.definition||'通过当前问题补充可核验的岗位能力证据。'}</p></section>`;
  const evidenceCard=`<section class="live-side-card evidence"><div class="live-side-head"><span>本题证据</span><b>0 / ${targets.length}</b></div><div class="live-evidence-targets">${targets.map(t=>`<div><i></i><span>${t}</span><em>待回答</em></div>`).join('')}</div></section>`;
  let stageMain='',stageAside='',stageClass='intro-stage',stageSubtitle='建立候选人上下文，确认后续项目深挖的起点。',historyBlock='';
  if(idx===0){
    stageClass='intro-stage'; stageSubtitle='先建立候选人与岗位上下文，再进入项目事实核验。';
    stageMain=`<main class="live-question-panel intro-scene"><div class="intro-scene-top"><div class="intro-person"><div class="intro-avatar">张</div><div><span>候选人开场</span><b>张同学 · ${esc(targetRole)}</b><p>90 秒 · 聚焦最能代表岗位能力的一段经历</p></div></div><div class="intro-timer">90<small>秒建议</small></div></div><div class="intro-question"><span>开场问题</span><h2>${q.text}</h2></div><div class="intro-anchor-head"><span>建议覆盖 3 个表达锚点</span><small>不是评分答案，只用于帮助组织真实经历</small></div><div class="intro-anchors"><div>${svgIcon('briefcase',16)}<span><b>业务目标</b><small>为什么做、解决什么问题</small></span></div><div>${svgIcon('user',16)}<span><b>本人职责</b><small>你具体负责了哪一部分</small></span></div><div>${svgIcon('check',16)}<span><b>项目结果</b><small>结果如何验证、产生什么变化</small></span></div></div>${answerComposer('用一段完整但简洁的自我介绍开始，先说业务目标，再说你的职责和结果…','开场回答会成为后续项目深挖的上下文')}</main>`;
    stageAside=`<aside class="live-insight-panel intro-side"><section class="live-side-card intro-guide"><div class="live-side-head"><span>开场结构</span><b>90 秒</b></div><ol><li><b>一句话背景</b><span>项目解决了什么业务问题</span></li><li><b>明确本人职责</b><span>避免只介绍团队做了什么</span></li><li><b>给出可验证结果</b><span>数据、指标或上线效果</span></li></ol></section><section class="live-side-card keyword-card"><div class="live-side-head"><span>岗位关键词</span><b>本轮关注</b></div><div class="keyword-cloud"><span>Java</span><span>Spring Boot</span><span>MySQL</span><span>Redis</span><span>稳定性</span></div><p>这些关键词来自当前岗位与简历，只决定追问方向，不直接计分。</p></section>${contextCard}</aside>`;
  }else if(idx===1){
    stageClass='project-stage'; stageSubtitle='围绕真实项目事实核验职责、技术取舍和结果，不接受只报技术名词。';
    stageMain=`<main class="live-question-panel project-scene"><div class="project-focus"><div><span>PROJECT DEEP DIVE</span><h3>校园场地预约服务</h3><p>后端接口 · MySQL · Redis · 性能优化</p></div><div class="project-result"><span>已知结果</span><b>420ms → 95ms</b></div></div><div class="project-role-strip"><span><b>你的角色</b>后端核心接口与性能优化</span><span><b>本轮焦点</b>技术取舍是否真实且可验证</span></div><div class="project-question"><span>项目追问</span><h2>${q.text}</h2></div><div class="decision-board"><div><span>01</span><b>备选方案</b><small>当时有哪些可选路径</small></div><div><span>02</span><b>最终选择</b><small>为什么采用这个方案</small></div><div><span>03</span><b>验证结果</b><small>怎么证明方案有效</small></div></div>${answerComposer('不要只说“用了联合索引”。说明备选方案、为什么这样选，以及最终如何验证…','项目回答提交后会进行证据缺口检查')}</main>`;
    stageAside=`<aside class="live-insight-panel project-side"><section class="live-side-card project-facts"><div class="live-side-head"><span>项目事实</span><b>来自简历</b></div><div class="project-fact-list"><div><span>项目</span><b>校园场地预约服务</b></div><div><span>本人职责</span><b>接口 / SQL / 缓存</b></div><div><span>量化结果</span><b>420ms → 95ms</b></div><div><span>待核验</span><b>取舍依据</b></div></div></section>${evidenceCard}<section class="live-side-card carry-card"><div class="live-side-head"><span>承接上一题</span><b>Q1</b></div><p>${esc((S.interview.answers[0]||'上一题尚未形成正式回答').slice(0,140))}</p></section></aside>`;
    historyBlock=previous?`<section class="live-history-panel compact-history"><div class="section-head"><div><h2>已确认上下文</h2><p class="muted">项目深挖会优先核验自我介绍中主动提到的经历。</p></div></div><div class="live-history-list">${previous}</div></section>`:'';
  }else if(idx===2){
    stageClass='scenario-stage'; stageSubtitle='进入岗位情景题，重点观察定位顺序、判断依据与止损决策。';
    stageMain=`<main class="live-question-panel scenario-scene"><div class="incident-banner"><div><span class="incident-dot"></span><div><span>线上情景 · SEV-2</span><b>核心接口响应时间持续升高</b></div></div><div class="incident-metrics"><span>P95 <b>2.8s ↑</b></span><span>错误率 <b>3.2% ↑</b></span><span>流量 <b>正常</b></span></div></div><div class="scenario-question"><span>你现在是值班工程师</span><h2>${q.text}</h2></div><div class="decision-timeline"><div><span>01</span><b>先看什么</b><small>指标与异常范围</small></div><i>→</i><div><span>02</span><b>怎么定位</b><small>工具与排查顺序</small></div><i>→</i><div><span>03</span><b>如何判断</b><small>证据与根因假设</small></div><i>→</i><div><span>04</span><b>怎么止损</b><small>恢复优先级与边界</small></div></div>${answerComposer('按真实线上处理顺序回答：先看哪些指标、用什么工具、如何缩小范围、什么时候止损…','情景题重点看判断链路，不要求背标准答案')}</main>`;
    stageAside=`<aside class="live-insight-panel scenario-side">${abilityCard}<section class="live-side-card incident-constraint"><div class="live-side-head"><span>场景约束</span><b>线上故障</b></div><ul><li><span>流量</span><b>未明显上涨</b></li><li><span>目标</span><b>先恢复可用性</b></li><li><span>限制</span><b>避免扩大影响</b></li></ul></section>${evidenceCard}</aside>`;
    historyBlock=previous?`<section class="live-history-panel"><div class="section-head"><div><h2>前序证据</h2><p class="muted">系统会结合前两阶段已确认的项目事实判断本题回答是否前后一致。</p></div><span class="badge verified">${answeredCount} 题已完成</span></div><div class="live-history-list">${previous}</div></section>`:'';
  }else{
    stageClass='summary-stage'; stageSubtitle='最后进行覆盖检查和反思补充，未覆盖能力保留为待验证。';
    const coverage=Math.round((answeredCount/r.questions.length)*100);
    const verifiedNames=(r.competencies||[]).slice(0,3).map(c=>`<span>${svgIcon('check',13)}${c.name}</span>`).join('');
    const pendingNames=(r.competencies||[]).slice(3,6).map(c=>`<span>${c.name}</span>`).join('');
    stageMain=`<main class="live-question-panel summary-scene"><div class="summary-overview"><div><span>本轮覆盖检查</span><h3>${answeredCount} / ${r.questions.length} 个阶段已有回答</h3><p>最后一题用于补充反思与工程意识，不会把未问到的能力直接计为低分。</p></div><div class="summary-ring"><strong>${coverage}%</strong><span>当前完成度</span></div></div><div class="summary-status-grid"><section><b>已形成证据</b><div>${verifiedNames}</div></section><section><b>仍需后续验证</b><div class="pending">${pendingNames}</div></section></div><div class="summary-question"><span>最后补充</span><h2>${q.text}</h2></div>${answerComposer('结合前面的项目和情景题，说明你最想补做的工程动作、原因以及它如何降低风险…','提交后将生成岗位匹配度、覆盖率和可审计证据报告')}</main>`;
    stageAside=`<aside class="live-insight-panel summary-side"><section class="live-side-card report-preview"><div class="live-side-head"><span>报告预览</span><b>提交后生成</b></div><div class="preview-kpis"><div><span>岗位匹配</span><strong>${avg(r)}%</strong></div><div><span>覆盖率</span><strong>${Math.max(50,coverage)}%</strong></div><div><span>待验证</span><strong>${Math.max(1,r.questions.length-answeredCount)}</strong></div></div></section><section class="live-side-card coverage-card"><div class="live-side-head"><span>覆盖状态</span><b>不等于得分</b></div><div class="coverage-list"><div><i class="ok"></i><span>项目经历</span><b>已验证</b></div><div><i class="ok"></i><span>技术取舍</span><b>已验证</b></div><div><i class="partial"></i><span>可靠性边界</span><b>部分</b></div><div><i></i><span>学习适应</span><b>待验证</b></div></div></section>${contextCard}</aside>`;
  }
  return `${pageHead('LIVE SESSION',`${idx+1}. ${q.stage}`,stageSubtitle,`<span class="badge blue">${S.interview.sourceMode==='job'?'岗位模式':'简历模式'}</span>`)}<section class="live-session-shell ${stageClass}"><div class="live-session-toolbar"><div class="live-session-status"><span class="live-dot"></span><b>面试进行中</b><span>${S.interview.sourceMode==='job'?'岗位定向':'简历驱动'}</span><span>阶段 ${idx+1} / ${r.questions.length}</span></div><div class="live-session-controls"><button class="ghost" id="interview-save">${svgIcon('file',14)} 保存草稿</button><button class="danger-ghost" id="interview-end">结束面试</button></div></div><div class="live-stage-wrap"><div class="stagebar">${stages}</div><div class="live-stage-line"><i style="width:${Math.round(((idx+1)/r.questions.length)*100)}%"></i></div></div><div class="live-workspace-grid">${stageMain}${stageAside}</div>${historyBlock}</section>`;
}

function drill(){
  const topics=drillTopics();
  if(!topics.some(x=>x.id===S.drill.topic)) persistTrainingDomain(recommendedDomains()[0]||topics[0]?.id||'sql');
  const current=topics.find(x=>x.id===S.drill.topic)||topics[0];
  if(S.drill.started){
    const bank=drillQuestions(current.id);
    const answered=S.drill.answers.filter(Boolean).length;
    const validScores=S.drill.scores.filter(x=>Number.isFinite(x));
    const avgScore=validScores.length?Math.round(validScores.reduce((a,b)=>a+b,0)/validScores.length):0;
    if(S.drill.finished){
      const after=Math.max(current.score,Math.min(92,avgScore||current.score));
      return `${pageHead('FOCUSED DRILL',`${current.name} · 本轮总结`,`本轮共 ${bank.length} 题，训练结果将作为新的能力证据写入长期画像。`,'<button class="ghost" id="drill-back">返回选题</button>')}
      <section class="drill-result-hero"><div><span>本轮完成</span><h2>${answered} / ${bank.length} 题</h2><p>${current.meta} · ${S.drill.source||'自主专项训练'}</p></div><div class="drill-result-score"><span>本轮平均</span><strong>${avgScore||'—'}</strong></div><div class="drill-result-score"><span>训练前</span><strong>${current.score}</strong></div><div class="drill-result-score gain"><span>画像建议</span><strong>${after}</strong><i>+${Math.max(0,after-current.score)}</i></div></section>
      <div class="drill-result-grid section"><section class="card"><div class="section-head"><h2>本轮能力表现</h2><span class="badge blue">${bank.length} 题综合</span></div><div class="drill-result-list"><div><span class="e-dot verified"></span><div><b>定位与验证链路</b><p>多数回答能覆盖现象、定位工具和量化结果。</p></div><strong>较好</strong></div><div><span class="e-dot partial"></span><div><b>方案边界与风险</b><p>部分题目仍需要补充失败场景、回滚与线上约束。</p></div><strong>待加强</strong></div><div><span class="e-dot gap"></span><div><b>复杂场景证据</b><p>建议继续训练高并发和故障定位类进阶题。</p></div><strong>优先</strong></div></div></section><section class="card"><div class="section-head"><h2>下一步</h2><span class="badge verified">可写回画像</span></div><div class="drill-next-actions"><button class="primary" id="drill-complete">完成训练并更新画像 →</button><button class="secondary" id="drill-restart">再练一轮</button><button class="ghost" id="drill-back-2">选择其他领域</button></div><div class="notice blue"><b>画像更新规则</b><span>只写入本轮已完成题目的训练证据；跳过题不会被当成低分。</span></div></section></div>`;
    }
    const idx=Math.min(S.drill.index,bank.length-1);
    const q=bank[idx];
    const progress=Math.round((idx/bank.length)*100);
    const currentAnswer=S.drill.answers[idx]||'';
    const currentScore=S.drill.scores[idx];
    const currentFeedback=S.drill.feedbacks?.[idx]||null;
    const helpText=S.drill.help==='hint'?`先围绕“${q[1]}”说明你会看什么信号，再给出判断和验证方法，不要只报结论。`:S.drill.help==='knowledge'?`知识点建议：${current.name} · ${q[1]}。回答时尽量包含机制、方案取舍、验证指标和边界条件。`:S.drill.help==='structure'?'推荐结构：现象/目标 → 定位或机制 → 方案与取舍 → 如何验证 → 风险与边界。':'';
    return `${pageHead('FOCUSED DRILL',current.name,`${bank.length} 题集中训练 · ${S.drill.source||'自主专项训练'}。完成后统一沉淀训练证据。`,'<button class="ghost" id="drill-back">退出本轮</button>')}
      <section class="drill-session-shell">
        <header class="drill-session-top"><div class="drill-session-mode"><span class="badge verified">专项训练</span><b>${current.name}</b><span>${answered}/${bank.length} 已答</span></div><button class="drill-end" id="drill-end">结束训练</button></header>
        <div class="drill-progress"><i style="width:${progress}%"></i><span>${idx+1} / ${bank.length}</span></div>
        <div class="drill-meta-strip"><span><b>能力</b>${current.meta}</span><span><b>训练前</b>${current.score}</span><span><b>当前能力点</b>${q[1]}</span><span><b>难度</b>${q[2]}</span><span><b>来源</b>${S.drill.source||'自主训练'}</span></div>
        <section class="drill-question-card">
          <div class="drill-question-head"><span>Q${idx+1}</span><div><b>${q[1]}</b><small>${q[2]} · 开放问答</small></div><div class="drill-difficulty" aria-label="题目难度">${q[2]==='进阶'?'★★★':q[2]==='中等'?'★★☆':'★☆☆'}</div></div>
          <div class="drill-question-text">${q[0]}</div>
        </section>
        <section class="drill-answer-card">
          <textarea id="drill-answer" placeholder="输入你的回答…（Enter 不会直接提交，可放心换行）">${esc(currentAnswer)}</textarea>
          <div class="drill-answer-tools"><div><button class="ghost" data-drill-help="hint">${svgIcon('sparkles',14)} 给提示</button><button class="ghost" data-drill-help="knowledge">${svgIcon('book',14)} 看知识点</button><button class="ghost" data-drill-help="structure">${svgIcon('file',14)} 答题结构</button></div><div><button class="text-link" id="drill-skip">跳过</button><button class="primary" id="drill-submit">${S.drill.submitted?'重新分析':'提交并分析'} →</button></div></div>
          ${helpText?`<div class="drill-help-panel"><b>${S.drill.help==='hint'?'回答提示':S.drill.help==='knowledge'?'相关知识点':'推荐答题结构'}</b><p>${helpText}</p></div>`:''}
        </section>
        ${S.drill.submitted?`<section class="drill-feedback-card"><div class="drill-feedback-head"><div><span>本题反馈</span><h3>${Number.isFinite(currentScore)&&currentScore>=82?'证据链较完整':'方向正确，继续补充可核验证据'}</h3></div><div class="drill-feedback-score"><strong>${currentScore||82}</strong><span>/100</span></div></div><div class="drill-feedback-body"><div><span class="e-dot verified"></span><p><b>已覆盖：</b>${esc((currentFeedback?.covered||[]).join('、')||'定位思路、关键机制和验证方向已经出现')}</p></div><div><span class="e-dot partial"></span><p><b>可加强：</b>${esc((currentFeedback?.missing||[]).join('、')||currentFeedback?.suggestion||'继续补充量化指标、方案取舍、失败场景或回滚边界')}</p></div></div><div class="drill-feedback-actions"><span>${S.drill.sessionId?'本题结果已写入训练会话，本轮完成后统一回流画像。':'本题结果已暂存，本轮完成后统一写入画像。'}</span><button class="primary" id="drill-next">${idx===bank.length-1?'查看本轮总结':'下一题'} →</button></div></section>`:''}
      </section>`;
  }
  const recommended=new Set(recommendedDomains());
  const cards=topics.map(t=>`<button class="domain-card ${S.drill.topic===t.id?'selected':''}" data-topic="${t.id}"><div class="domain-card-top"><span class="domain-mark">${esc(t.mark||t.name.slice(0,2))}</span><div><span>${esc(t.meta)}</span>${recommended.has(t.id)?'<b>岗位推荐</b>':''}</div></div><h3>${esc(t.name)}</h3><p>${esc(t.desc||'围绕该领域核心知识和高频问题进行训练')}</p><div class="domain-tags">${(t.tags||[]).slice(0,3).map(x=>`<span>${esc(x)}</span>`).join('')}</div><footer><span>${drillQuestions(t.id).length} 道题</span><span>掌握度 <b>${t.score}</b></span></footer></button>`).join('');
  const createCard=`<button class="domain-card create-domain" id="domain-create-open"><span class="create-plus">＋</span><h3>新建领域</h3><p>添加 Vue、Docker、Linux、Kafka 等你想单独训练的方向。</p><footer><span>自定义题库</span><span>立即创建 →</span></footer></button>`;
  const modal=S.drill.createOpen?`<div class="domain-modal-backdrop" id="domain-modal-backdrop"><section class="domain-modal"><header><div><span>NEW DOMAIN</span><h2>新建训练领域</h2><p>创建后会同时出现在专项训练和题目图谱中。</p></div><button id="domain-create-close">×</button></header><div class="field"><label>领域名称</label><input id="domain-name" maxlength="24" placeholder="例如：Kafka"></div><div class="field"><label>领域简介</label><textarea id="domain-desc" maxlength="120" placeholder="例如：围绕消息投递、消费组、重平衡与可靠性进行训练"></textarea></div><div class="field"><label>标签 <small>用逗号分隔</small></label><input id="domain-tags" placeholder="消息队列, Consumer, 可靠性"></div><footer><button class="ghost" id="domain-create-cancel">取消</button><button class="primary" id="domain-create-save">创建领域</button></footer></section></div>`:'';
  return `${pageHead('TOPIC DRILL','专项强化训练','选择一个训练领域，AI 会参考该领域的核心知识和高频题目动态追问。',`<button class="ghost" data-nav="graph">查看题目图谱 →</button>`)}${S.drill.source?`<div class="notice blue drill-source"><b>训练来源</b><span>${S.drill.source}</span></div>`:''}<section class="domain-recommend"><div><span>${svgIcon('sparkles',14)}</span><div><b>${role().name} 推荐训练</b><p>岗位只影响推荐顺序，不限制你选择其他领域。</p></div></div><div>${recommendedDomains().map(id=>`<button data-topic="${id}">${trainingDomain(id).name}</button>`).join('')}</div></section><div class="domain-grid">${cards}${createCard}</div><section class="start-panel section"><div><b>当前领域：${current.name} · ${drillQuestions(current.id).length} 道题</b><span>${current.desc||drillQuestions(current.id)[0][0]}</span></div><div class="domain-start-actions"><button class="ghost" data-nav="graph">查看图谱</button><button class="primary" id="drill-start">开始训练 →</button></div></section>${modal}`;
}


function questionGraph(){
  const domains=S.graph.data?.domains?.length?S.graph.data.domains:allTrainingDomains();
  if(!domains.some(d=>d.id===S.graph.domain)) S.graph.domain=S.graph.data?.default_domain||'sql';
  const current=graphDomainData(S.graph.domain)||trainingDomain(S.graph.domain);
  const allNodes=graphNodes();
  const allEdges=graphEdges();
  if(!allNodes.some(n=>n.id===S.graph.node)) S.graph.node=allNodes[0]?.id||'';
  const selected=graphNodeById(S.graph.node);
  const q=graphQuestion(selected);
  const relations=graphRelations(selected.id);
  const relationIds=new Set(relations.map(x=>x.id)); relationIds.add(selected.id);
  const edges=allEdges.map(([a,b,type])=>{
    const na=graphNodeById(a),nb=graphNodeById(b),active=(a===selected.id||b===selected.id);
    return `<line class="graph-edge ${type} ${active?'active':''}" x1="${na.x}" y1="${na.y}" x2="${nb.x}" y2="${nb.y}"></line>`;
  }).join('');
  const nodes=allNodes.map(n=>`<button class="graph-node ${n.status} ${n.id===selected.id?'selected':''} ${relationIds.has(n.id)?'related':''}" style="left:${n.x/10}%;top:${n.y/6}%" data-graph-node="${n.id}" aria-label="${esc(n.label)}"><span class="graph-node-dot"></span><b>${esc(n.label)}</b><small>${n.score}</small></button>`).join('');
  const relationNames={prerequisite:'前置关系',related:'相关能力',evidence:'证据迁移'};
  const relationList=relations.map(r=>{const n=graphNodeById(r.id);return `<button data-graph-node="${n.id}"><span class="rel-dot ${r.type}"></span><div><b>${esc(n.label)}</b><small>${relationNames[r.type]} · ${esc(current.name)}</small></div><em>→</em></button>`}).join('');
  const statusText=STATUS[selected.status]||'待验证';
  const difficulty=q[2]||'中等';
  const legend=S.graph.legendOpen?`<div class="graph-legend-pop"><header><b>图例</b><button id="graph-legend-close">×</button></header><div><span class="legend-node gap"></span>存在缺口</div><div><span class="legend-node partial"></span>部分验证</div><div><span class="legend-node verified"></span>已验证</div><hr><div><span class="legend-line prerequisite"></span>前置关系</div><div><span class="legend-line related"></span>相关能力</div><div><span class="legend-line evidence"></span>证据迁移</div></div>`:'';
  const recommended=new Set(S.graph.data?.recommended_domains||recommendedDomains());
  const domainTabs=domains.map(d=>`<button class="${S.graph.domain===d.id?'active':''}" data-graph-domain="${d.id}"><span class="domain-tab-mark">${esc(d.mark||d.name.slice(0,2))}</span><div><b>${esc(d.name)}</b><small>${(d.questions?.length||drillQuestions(d.id).length)} 题${recommended.has(d.id)?' · 推荐':''}</small></div></button>`).join('');
  return `${pageHead('QUESTION GRAPH','题目图谱','和专项训练使用同一套领域与题库。切换领域后，题目节点、关系和训练入口会同步变化。','<button class="primary" id="graph-open-domain-drill">进入当前领域训练 →</button>')}
    <section class="graph-domain-selector"><div class="graph-domain-selector-head"><div><span>${svgIcon('target',15)}</span><div><b>训练领域</b><p>当前领域：${esc(current.name)} · ${esc(current.desc||'核心知识与高频题')}</p></div></div><button class="ghost" id="graph-create-domain">＋ 新建领域</button></div><div class="graph-domain-grid">${domainTabs}</div></section>
    <section class="graph-summary-strip"><div><span>领域题目</span><strong>${allNodes.length}</strong><small>${current.name}</small></div><div><span>存在缺口</span><strong>${allNodes.filter(n=>n.status==='gap').length}</strong><small>建议优先训练</small></div><div><span>部分验证</span><strong>${allNodes.filter(n=>n.status==='partial').length}</strong><small>继续补证据</small></div><div><span>已验证</span><strong>${allNodes.filter(n=>n.status==='verified').length}</strong><small>可作为迁移证据</small></div><div class="graph-summary-note"><span>${svgIcon('sparkles',14)}</span><div><b>${recommended.has(current.id)?role().name+' 推荐领域':'领域独立训练'}</b><p>岗位只负责推荐领域；题目和图谱始终按领域组织。</p></div></div></section>
    <div class="drill-graph-layout standalone-graph-layout">
      <section class="drill-graph-card">
        <header class="graph-toolbar"><div><span>${esc(current.meta)} · ${esc(current.name)}</span><b>${allNodes.length} 个节点 · 点击查看题目、能力与联系</b></div><div><button id="graph-zoom-out" title="缩小">−</button><span id="graph-scale">${Math.round(S.graph.scale*100)}%</span><button id="graph-zoom-in" title="放大">＋</button><button id="graph-center">居中</button><button class="graph-legend-toggle ${S.graph.legendOpen?'active':''}" id="graph-legend-toggle">图例</button></div></header>
        <div class="graph-viewport ${S.graph.focusRelated?'focus-related':''}" id="graph-viewport"><div class="graph-canvas" id="graph-canvas" style="transform:scale(${S.graph.scale})"><svg viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">${edges}</svg>${nodes}</div>${legend}</div>
        <footer class="graph-footer"><span><i class="pulse-dot"></i>已选中：<b>${esc(selected.label)}</b></span><span>${esc(current.name)} · 节点关系只在本领域内展开</span></footer>
      </section>
      <aside class="graph-detail-panel standalone-detail">
        <div class="graph-detail-head"><div><span>${esc(current.name)}</span><h2>${esc(selected.label)}</h2></div><strong>${selected.score}</strong></div>
        <div class="graph-detail-badges"><span class="badge ${selected.status}">${statusText}</span><span>${difficulty}</span><span>${esc(current.meta)}</span></div>
        <section class="graph-question-box"><span>训练题目</span><p>${esc(q[0])}</p></section>
        <section class="graph-detail-meta"><div><span>知识点</span><b>${esc(q[1])}</b></div><div><span>当前掌握</span><b>${selected.score}/100</b></div><div><span>所属领域</span><b>${esc(current.name)}</b></div><div><span>直接关联</span><b>${relations.length} 个节点</b></div></section>
        <section class="graph-relations"><header><span>节点联系</span><b>${relations.length}</b></header><div>${relationList||'<p class="graph-no-rel">暂无直接关联节点</p>'}</div></section>
        <div class="graph-detail-actions"><button class="primary" id="graph-train-node">训练这道题 →</button><button class="ghost" id="graph-focus-node">${S.graph.focusRelated?'显示全部节点':'只看关联节点'}</button></div>
      </aside>
    </div>`;
}

async function audioFileToPcm16k(file){
  if(!file) throw new Error('audio_file_missing');
  const AudioCtx=window.AudioContext||window.webkitAudioContext;
  if(!AudioCtx) throw new Error('browser_audio_decode_unavailable');
  const ctx=new AudioCtx();
  try{
    const source=await file.arrayBuffer();
    const decoded=await ctx.decodeAudioData(source.slice(0));
    if(!decoded?.length||!decoded.sampleRate) throw new Error('audio_decode_empty');
    if(decoded.duration>600) throw new Error('audio_over_10_minutes');
    const targetRate=16000;
    const ratio=decoded.sampleRate/targetRate;
    const outLength=Math.max(1,Math.floor(decoded.length/ratio));
    const out=new ArrayBuffer(outLength*2);
    const view=new DataView(out);
    const channels=Array.from({length:decoded.numberOfChannels},(_,i)=>decoded.getChannelData(i));
    for(let i=0;i<outLength;i++){
      const pos=i*ratio;
      const i0=Math.min(decoded.length-1,Math.floor(pos));
      const i1=Math.min(decoded.length-1,i0+1);
      const frac=pos-i0;
      let sample=0;
      for(const ch of channels) sample+=(ch[i0]*(1-frac)+ch[i1]*frac);
      sample/=Math.max(1,channels.length);
      sample=Math.max(-1,Math.min(1,sample));
      view.setInt16(i*2,sample<0?sample*0x8000:sample*0x7fff,true);
    }
    return new Blob([out],{type:'application/octet-stream'});
  }finally{
    try{await ctx.close();}catch(e){}
  }
}

function recordingTranscriptSegments(R=S.recording){
  const source=(R.segments?.length?R.segments:(R.analysis?.asr_segments||[]));
  if(source.length) return source.map((x,i)=>({speaker:x.speaker||'unknown',text:x.text||'',start_ms:x.start_ms??null,end_ms:x.end_ms??null,role_id:x.role_id??null,index:i}));
  const lines=(R.text||'').split(/\n+/).map(x=>x.trim()).filter(Boolean);
  return lines.map((line,i)=>{
    let speaker=R.mode==='solo'?'candidate':'unknown',text=line;
    if(/^(面试官|interviewer)[：:]/i.test(line)){speaker='interviewer';text=line.replace(/^[^：:]+[：:]/,'').trim();}
    else if(/^(候选人|我|candidate)[：:]/i.test(line)){speaker='candidate';text=line.replace(/^[^：:]+[：:]/,'').trim();}
    return {speaker,text,index:i,start_ms:null,end_ms:null,role_id:null};
  });
}

function recording(){
  const R=S.recording;
  const dialogue=R.mode==='dialogue';
  const audio=R.input==='audio';
  const hasSource=audio?Boolean(R.fileName):Boolean((R.text||'').trim());
  const transcriptReady=audio?R.transcribed:hasSource;
  const step=R.analyzed?3:transcriptReady?2:1;
  const sourceLabel=audio?(R.fileName||'待选择录音文件'):'已粘贴文本';
  const text=(R.text||'').trim();
  const analysis=R.analysis||{};
  const qaItems=Array.isArray(analysis.qa)?analysis.qa:[];
  const rawEvidence=Array.isArray(analysis.evidence)?analysis.evidence:[];
  const observations=analysis.observations||{};
  const transcriptSegments=recordingTranscriptSegments(R);
  const transcriptRows=transcriptSegments.map(seg=>`<div class="record-speaker ${seg.speaker==='interviewer'?'interviewer':seg.speaker==='candidate'?'candidate':'unknown'}"><span>${seg.speaker==='interviewer'?'面试官':seg.speaker==='candidate'?'你':'说话人'}</span><p>${esc(seg.text)}</p>${seg.start_ms!=null?`<small>${Math.floor(seg.start_ms/60000)}:${String(Math.floor((seg.start_ms%60000)/1000)).padStart(2,'0')}</small>`:''}</div>`).join('');
  const firstQa=qaItems[0]||null;
  const evidence=rawEvidence.slice(0,5).map(e=>[e.label||e.slot||'回答证据',e.quote||'已从原始回答中定位到证据','verified','已获得']);
  const missing=firstQa?.missing||[];
  return `${pageHead('RECORDING REVIEW','录音复盘','上传面试录音或直接粘贴文本，先拿到可分析文本，再进入 AI 复盘。')}
  <div class="record-workbench">
    <section class="record-mode-card">
      <div class="record-section-head"><div><span>录音模式</span><h2>先告诉系统这段内容是什么</h2><p>不同模式会影响说话人识别、问题拆分和表达分析方式。</p></div><span class="badge blue">当前：${dialogue?'双人对话':'单人录音'}</span></div>
      <div class="record-mode-switch">
        <button class="${dialogue?'active':''}" data-record-mode="dialogue"><span>${svgIcon('mic',16)}</span><div><b>双人对话</b><small>面试官 + 你 · 适合完整面试录音</small></div></button>
        <button class="${!dialogue?'active':''}" data-record-mode="solo"><span>${svgIcon('user',16)}</span><div><b>单人录音</b><small>只有你 · 适合自我介绍、技术表达或复盘独白</small></div></button>
      </div>
    </section>

    <section class="record-context-card">
      <div class="record-section-head"><div><span>复盘上下文</span><h2>补充岗位信息</h2><p>公司和岗位不是必填，但填写后可以把录音证据对照到更准确的岗位能力。</p></div></div>
      <div class="record-context-grid"><div class="field"><label>公司 <small>可选</small></label><input id="record-company" value="${esc(R.company)}" placeholder="例如：字节跳动"></div><div class="field"><label>岗位 <small>可选</small></label><input id="record-role" value="${esc(R.role)}" placeholder="例如：Java 后端开发工程师"></div></div>
    </section>

    <section class="record-input-card">
      <div class="record-section-head"><div><span>输入方式</span><h2>准备可分析内容</h2><p>上传录音适合完整面试复盘；粘贴文字适合已有转写稿或手动整理后的内容。</p></div></div>
      <div class="record-input-tabs"><button class="${audio?'active':''}" data-record-input="audio">${svgIcon('mic',14)} 上传录音</button><button class="${!audio?'active':''}" data-record-input="text">${svgIcon('file',14)} 粘贴文字</button></div>
      ${audio?`<div class="record-upload-zone ${R.fileName?'has-file':''}"><input id="record-file-input" type="file" accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg" hidden><div class="upload-icon">${svgIcon('mic',20)}</div><b>${R.fileName?esc(R.fileName):'点击上传音频文件'}</b><span id="record-file-label">${R.transcribing?'浏览器正在转换为 16k 单声道并提交讯飞转写…':R.fileName?'文件已准备，可生成真实转写文本':'支持 mp3、wav、m4a、webm、ogg 等 Chrome 可解码格式'}</span><button class="ghost" id="record-pick-file" ${R.transcribing?'disabled':''}>${R.fileName?'重新选择':'选择文件'}</button></div>
      <div class="record-input-notes"><div><b>完整录音优先</b><span>不要只截最后几分钟，否则上下文会断掉。</span></div><div><b>先转写再分析</b><span>复盘基于可核对文本，而不是直接把音频当结论。</span></div><div><b>音质越稳越好</b><span>背景噪音越少，说话人和内容识别越稳定。</span></div></div>`:`<div class="record-text-wrap"><textarea id="record-text" placeholder="粘贴完整面试转写文本。双人对话建议保留“面试官：/ 候选人：”等说话人标记。">${esc(R.text)}</textarea><div><span>${text.length} 字</span><small>${dialogue?'建议保留问答双方说话人标签':'系统会重点分析内容完整度、结构和表达质量'}</small></div></div>`}
    </section>

    <section class="record-decision-card">
      <div class="record-section-head"><div><span>决策面板</span><h2>${R.analyzed?'复盘已完成':transcriptReady?'可分析文本已准备':'先拿到可分析文本'}</h2></div><span class="badge ${R.analyzed?'verified':transcriptReady?'blue':'unknown'}">${R.analyzed?'已完成':transcriptReady?'待分析':'待输入'}</span></div>
      <div class="record-step-list"><div class="${step>=1?'active':''}"><span>01</span><div><b>选择录音模式</b><p>${dialogue?'双人对话 · 面试官 + 你':'单人录音 · 只有你'}</p></div></div><div class="${step>=1&&hasSource?'active':''}"><span>02</span><div><b>准备输入内容</b><p>${hasSource?sourceLabel:'先选择录音文件或粘贴文本'}</p></div></div><div class="${step>=2?'active':''}"><span>03</span><div><b>获取可分析文本</b><p>${transcriptReady?'文本已准备，可以进入 AI 复盘':audio?'上传后先生成转写文本':'粘贴完整文本后即可分析'}</p></div></div></div>
      <div class="record-metrics"><div><span>输入来源</span><b>${audio?'录音文件':'粘贴文本'}</b></div><div><span>文本长度</span><b>${transcriptReady?`${text.length||68} 字`:'0'}</b></div><div><span>音频文件</span><b>${audio?(R.fileName||'未选'):'不适用'}</b></div><div><span>当前模式</span><b>${dialogue?'双人对话':'单人录音'}</b></div></div>
      ${audio&&!R.transcribed?`<button class="primary big full" id="record-transcribe" ${R.fileName&&!R.transcribing?'':'disabled'}>${R.transcribing?'正在实时转写，请保持页面打开…':R.fileName?'讯飞实时转写 →':'先选择录音文件'}</button>`:`<button class="primary big full" id="record-analyze" ${transcriptReady?'':'disabled'}>${R.analyzed?'重新分析':'开始 AI 复盘'} →</button>`}
    </section>

    ${transcriptReady&&!R.analyzed?`<section class="record-transcript-card"><div class="record-section-head"><div><span>转写确认</span><h2>先核对文本，再开始复盘</h2><p>分析结论会引用这里的原始文本，因此建议先确认关键信息没有转写错误。</p></div><span class="badge verified">${R.transcriptionMeta?.speaker_separation?'已开启说话人分离':'文本已准备'}</span></div><div class="record-transcript-body">${transcriptRows||`<div class="record-speaker ${dialogue?'unknown':'candidate solo'}"><span>${dialogue?'说话人':'你'}</span><p>${esc(text)}</p></div>`}</div></section>`:''}

    ${R.analyzed?`<section class="record-review-overview"><div class="record-section-head"><div><span>AI 复盘结果</span><h2>${R.role||'本次面试'} · 证据复盘</h2><p>${dialogue?'录音中的追问和回答已经结构化为 Evidence，可继续进入专项训练或画像更新。':'单人表达已按内容结构与证据具体度完成复盘，并生成可回流的 Evidence。'}</p></div><span class="badge ${rawEvidence.length?'verified':'partial'}">${rawEvidence.length?'Evidence 已生成':'仍需补证据'}</span></div><div class="record-review-kpis"><div><span>${dialogue?'结构化问答':'表达片段'}</span><strong>${dialogue?qaItems.length:Math.max(1,transcriptSegments.length)}</strong><small>已识别</small></div><div><span>已获得证据</span><strong>${rawEvidence.length}</strong><small>来自原始回答</small></div><div><span>待补证据</span><strong>${Number(observations.missing_count??missing.length)}</strong><small>${dialogue?'建议补问':'建议补充'}</small></div><div><span>证据状态</span><strong>${rawEvidence.length?'已入库':'待补充'}</strong><small>${R.recordId?'已持久化':'当前会话'}</small></div></div></section>
    <section class="record-review-grid"><article class="record-review-panel"><div class="record-section-head"><div><span>${dialogue?'问答复盘':'内容复盘'}</span><h2>${dialogue?'关键回答与判断':'这段表达讲清楚了什么'}</h2></div></div>${dialogue?(firstQa?`<div class="qa-block"><span>Q1 · ${esc(firstQa.competency_id||'回答证据')}</span><b>${esc(firstQa.question||'')}</b><p>“${esc(firstQa.answer||'')}”</p></div>`:'<div class="empty-state compact-empty"><div>○</div><b>尚未识别出完整问答对</b><span>可以先核对说话人和转写文本，再重新分析。</span></div>'):`<div class="record-solo-summary"><blockquote>“${esc(text.slice(0,260))}${text.length>260?'…':''}”</blockquote></div>`}<div class="record-evidence-list">${evidence.length?evidence.map(e=>`<div><span class="e-dot ${e[2]}"></span><div><b>${esc(e[0])}</b><p>${esc(e[1])}</p></div><em class="badge ${e[2]}">${e[3]}</em></div>`).join(''):'<div class="empty-state compact-empty"><div>○</div><b>当前没有可核验 Evidence</b><span>复盘不会为缺失信息制造证据，建议补充更具体的职责、行动、取舍和结果。</span></div>'}</div></article><aside class="record-review-panel"><div class="record-section-head"><div><span>表达与过程</span><h2>${dialogue?'面试表现观察':'表达质量观察'}</h2></div></div><div class="record-observation"><div><b>${dialogue?'回答结构':'内容结构'}</b><strong>${Math.round(Number(observations.structure_score||0))}</strong><p>${esc(observations.structure==='清晰'?'已识别到较完整的表达/问答结构。':'当前结构仍较短或说话人边界不够清晰。')}</p></div><div><b>证据具体度</b><strong>${Math.round(Number(observations.specificity_score||0))}</strong><p>${esc(observations.specificity==='较高'?'回答中包含数字或较具体的可核验信息。':'当前量化结果和具体事实仍偏少。')}</p></div><div><b>证据覆盖</b><strong>${Math.round(Number(observations.evidence_score||0))}</strong><p>仅按本次原始转写中真正提取到的 Evidence 槽位计算，不把缺失项当作已获得。</p></div></div></aside></section>
    <section class="record-next-actions"><div><span>下一步</span><h2>把这次真实面试变成下一轮训练</h2><p>低证据项不会直接变成永久低分；你可以先针对缺口训练，再把新证据回流到画像。</p></div><div><button class="secondary" id="record-train">针对缺口训练</button><button class="ghost" data-nav="report">查看证据报告</button><button class="primary" id="record-profile">写入画像 →</button></div></section>`:''}
  </div>`;
}

function report(){
  if(!S.reportData&&!S.interview.sessionId){
    return `${pageHead('AUDITABLE REVIEW','评估报告','完成一轮岗位评估后，这里会展示覆盖率、岗位匹配度以及可回到原始回答的 Evidence Audit。')}<section class="empty-state"><div>${svgIcon('check',24)}</div><b>还没有可查看的评估报告</b><span>先完成一轮简历面试或岗位面试；未完成、未回答的能力会保持待验证。</span><button class="primary" data-nav="interview">开始岗位评估 →</button></section>`;
  }
  const r=role();
  const backend=S.reportData;
  const jobAnalysis=currentInterviewJobAnalysis();
  const reportRoleName=jobAnalysis?.role_name||S.interview.targetRole||r.name;
  const match=Number(backend?.match_score??avg(r));
  const activeIndex=Math.min(S.auditIndex??0,Math.max(0,(backend?.competencies||r.competencies||[]).length-1));
  const roleMap=new Map((r.competencies||[]).map(x=>[x.id,x]));
  const competencies=(backend?.competencies?.length?backend.competencies.map(x=>{const rc=roleMap.get(x.competency_id)||{};return {...rc,id:x.competency_id,name:x.name||rc.name,score:x.score,status:x.status,weight:x.weight??rc.weight,rubric_score:x.rubric_score,evidence_ids:x.evidence_ids||[],evidence_slots:x.evidence_slots||[],reason:x.reason||''};}):r.competencies||[]);
  const scoreText=c=>c?.score===null||c?.score===undefined?'—':String(Math.round(Number(c.score)));
  const rows=competencies.map((c,i)=>`<button class="report-v3-audit-row ${activeIndex===i?'active':''}" data-audit="${i}"><div class="report-v3-audit-main"><span class="report-v3-audit-dot ${c.status}"></span><div><b>${c.name}</b><small>${c.definition||c.reason||'当前能力证据审计'}</small></div></div><div class="report-v3-audit-score"><strong>${scoreText(c)}</strong><span class="badge ${c.status}">${STATUS[c.status]||'待验证'}</span></div><i>→</i></button>`).join('');
  const dimensions=competencies.map((c,i)=>`<article class="report-v3-skill ${i===activeIndex?'focus':''}"><div class="report-v3-skill-head"><div><span>${c.required?'核心能力':'通用能力'}</span><b>${c.name}</b></div><strong>${scoreText(c)}</strong></div><div class="report-v3-skill-bar"><i style="width:${c.score==null?6:Math.max(6,c.score)}%"></i></div><div class="report-v3-skill-foot"><span>${STATUS[c.status]||'待验证'}</span><small>权重 ${c.weight||0}%</small></div></article>`).join('');
  const c=competencies[activeIndex]||{};
  const qs=currentInterviewQuestions();
  let qi=qs.findIndex(q=>questionCompetency(q)===c.id); if(qi<0) qi=Math.min(activeIndex,Math.max(0,qs.length-1));
  const audit=S.auditData||null;
  const aq=audit?.question||qs[qi]||{};
  const reportSignals=S.interview.sourceMode==='job'?currentJobSignals():(r.jdSignals||[]);
  const signal=audit?.job_source||(reportSignals.find(s=>(s.competency_id||s.competency)===c.id)||reportSignals[0]||{});
  const fallbackRaw=S.interview.answers[qi]&&S.interview.answers[qi]!=='[SKIPPED]'?S.interview.answers[qi]:'';
  const raw=audit?.answer?.raw_text||fallbackRaw;
  const sourceLabel=S.interview.sourceMode==='job'?'岗位模式 · JD 驱动':'简历模式 · 经历驱动';
  const evidenceLevel=Math.round((audit?.evidence_confidence??(c.status==='verified'?0.92:c.status==='partial'?0.68:c.status==='gap'?0.42:0.18))*100);
  const coverage=Math.round(Number(backend?.coverage??.81)*100);
  const evaluated=Number(backend?.summary?.evaluated_count??competencies.filter(x=>x.status!=='unknown').length);
  const total=Number(backend?.summary?.total_count??competencies.length);
  const pending=Number(backend?.summary?.pending_count??Math.max(0,total-evaluated));
  const sufficiency=Math.round(Number(backend?.sufficiency??.65)*100);
  const sufficiencyText=sufficiency>=85?'高':sufficiency>=55?'中等':'偏低';
  const nextTarget=[...competencies].sort((a,b)=>{const ap=a.status==='unknown'?0:a.status==='gap'?1:a.status==='partial'?2:3,bp=b.status==='unknown'?0:b.status==='gap'?1:b.status==='partial'?2:3;if(ap!==bp)return ap-bp;return Number(b.weight||0)-Number(a.weight||0);})[0]||{};
  return `${pageHead('AUDITABLE REVIEW','评估报告','从岗位匹配到原始回答证据，把“得了多少分”和“为什么是这个分”放在同一份报告里。',`<div class="report-head-actions"><button class="ghost" data-nav="history">历史报告</button><button class="primary" id="report-train">针对薄弱项训练</button></div>`)}
  <div class="report-v3-page">
    <section class="report-v3-hero">
      <div class="report-v3-score-zone"><div class="report-v3-ring" style="--report-score:${match}"><div><strong>${match}</strong><span>%</span><small>岗位匹配度</small></div></div><div class="report-v3-score-copy"><span>当前目标岗位</span><h2>${esc(reportRoleName)}</h2><p>当前结论仅聚合已经获得的回答证据。未问到、未完成或证据不足的能力保持“待验证”，不会被直接记为低分。</p><div class="report-v3-score-tags"><em>${svgIcon('check',12)} ${evaluated} / ${total} 能力已覆盖</em><em class="warn">${svgIcon('clock',12)} ${pending} 项待验证</em></div></div></div>
      <div class="report-v3-verdict"><div class="report-v3-verdict-head"><span>本轮结论</span><b>证据充分度：${sufficiencyText}</b></div><h3>本轮已形成 ${evaluated} 个能力维度的可评分证据，${pending} 个维度仍保持待验证；岗位匹配度仅基于已评估能力聚合。</h3><div class="report-v3-verdict-grid"><article class="good"><span>${svgIcon('check',13)}</span><div><b>已形成证据</b><p>${evaluated?`已有 ${evaluated} 个能力维度进入 Rubric 评分，可继续点击下方审计原始回答。`:'当前还没有足够回答形成能力评分。'}</p></div></article><article class="risk"><span>!</span><div><b>优先补强</b><p>${pending?`${pending} 个能力仍待验证，建议从高权重能力开始补问或专项训练。`:'当前岗位核心能力已基本完成验证，可继续通过训练提高证据质量。'}</p></div></article></div></div>
    </section>

    <section class="report-v3-overview">
      <div class="report-v3-section-title"><div><span>能力概览</span><h2>岗位能力分布</h2><p>先看能力结构，再进入下面的证据审计。</p></div><button class="ghost" data-nav="profile">查看长期画像 →</button></div>
      <div class="report-v3-overview-grid"><div class="report-v3-skills">${dimensions}</div><aside class="report-v3-metrics"><div class="report-v3-metric primary"><span>岗位匹配度</span><strong>${match}%</strong><small>仅聚合已评估能力</small></div><div><span>评估覆盖率</span><strong>${coverage}%</strong><small>${evaluated} / ${total} 个能力维度已评估</small></div><div><span>待验证能力</span><strong>${pending}</strong><small>不计入已评估分母</small></div><div><span>结论充分度</span><strong class="text">${sufficiencyText}</strong><small>${sufficiency}% · 随覆盖率动态变化</small></div></aside></div>
    </section>

    <section class="report-v3-evidence">
      <div class="report-v3-section-title"><div><span>Evidence Audit</span><h2>能力证据审计</h2><p>点击左侧任意能力，右侧立即展开该分数对应的岗位来源、问题、原回答与 Rubric。</p></div><span class="report-v3-evidence-badge">${svgIcon('sparkles',12)} Evidence-grounded</span></div>
      <div class="report-v3-evidence-grid"><div class="report-v3-audit-list">${rows}</div><aside class="report-v3-detail"><header><div><span>当前审计项</span><h3>${c.name||''}</h3><p>${c.definition||c.reason||'当前能力的可审计证据链'}</p></div><div class="report-v3-detail-score"><strong>${scoreText(c)}</strong><span class="badge ${c.status||'unknown'}">${STATUS[c.status]||'待验证'}</span></div></header><div class="report-v3-evidence-level"><span>本项证据充分度</span><div><i style="width:${evidenceLevel}%"></i></div><b>${c.status==='verified'?'高':c.status==='partial'?'中等':c.status==='gap'?'偏低':'待验证'}</b></div><div class="report-v3-chain"><article><span>01</span><div><b>JD / 岗位标准来源</b><p>“${esc(signal.quote||'当前岗位能力标准')}”</p></div></article><article><span>02</span><div><b>面试问题 · ${sourceLabel}</b><p>${esc(aq.text||'当前能力尚未覆盖到具体问题')}</p></div></article><article class="quote"><span>03</span><div><b>原始回答引用</b>${raw?`<blockquote>“${esc(raw.slice(0,260))}${raw.length>260?'…':''}”</blockquote>`:'<p>尚未获得该能力的原始回答，因此保持待验证。</p>'}</div></article><article><span>04</span><div><b>Rubric</b><p>${audit?.rubric?.level?`L${audit.rubric.level}：${esc(audit.rubric.criteria||'')}`:'当前能力尚未形成可评分 Rubric，保持待验证。'}</p></div></article><article><span>05</span><div><b>判断理由</b><p>${esc(audit?.reason||c.reason||'评分只使用当前会话中已经获得的回答证据；未覆盖内容保留为待验证，不直接计为低分。')}</p></div></article></div></aside></div>
    </section>

    <section class="report-v3-next"><div><span>Next Step</span><h2>把报告中的缺口，直接变成下一轮训练任务</h2><p>${nextTarget.id?`当前优先处理“${esc(nextTarget.name)}”：${nextTarget.status==='unknown'?'本轮尚未获得可评分证据，先完成验证。':'现有证据仍可继续补强。'} 新证据会继续写回长期画像。`:'当前报告暂无明确缺口，可继续通过岗位训练提高证据质量。'}</p></div><div><button class="secondary" id="report-train-2">开始薄弱项训练</button><button class="primary" data-nav="profile">查看画像变化 →</button></div></section>
  </div>`;
}

function profile(){
  const r=role();
  const pdata=S.profile.data||{};
  const competencies=(pdata.competencies?.length?pdata.competencies.map(c=>({id:c.competency_id,name:c.name,score:Number(c.score??0),status:c.status,latestAssessmentStatus:c.latest_assessment_status||'unknown',latestAssessmentScore:c.latest_assessment_score,weight:c.weight,latest_reason:c.latest_reason,updated_at:c.updated_at})):r.competencies||[]);
  const score=Number(pdata.score??avg(r));
  const stats=pdata.practice_stats||{};
  const fmtDate=v=>v?new Date(v).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'待验证';
  const serverEvents=(pdata.events||[]).map(e=>({sessionId:e.session_id,title:`${competencies.find(c=>c.id===e.competency_id)?.name||e.competency_id} ${e.before??'—'} → ${e.after??'—'}`,source:`${e.source==='assessment'?'岗位评估':e.source==='training'?'专项训练':e.source==='recording'?'录音复盘':e.source} · ${fmtDate(e.created_at)}`,detail:e.reason||'能力证据已更新。'}));
  const events=pdata.events?serverEvents:S.events;
  const acquired=(pdata.evidence||[]).map(x=>({...x,date:fmtDate(x.created_at)}));
  const pending=(pdata.pending_evidence||[]).map(x=>({...x,date:fmtDate(x.created_at)}));
  const evidence=[...pending,...acquired];
  const filtered=evidence.filter(x=>S.profile.evidenceFilter==='all'||(S.profile.evidenceFilter==='gap'?['gap','unknown'].includes(x.type):x.type===S.profile.evidenceFilter));
  const visible=S.profile.evidenceExpanded?filtered:filtered.slice(0,5);
  const due=pending.slice(0,3);
  const focus=pdata.focus||competencies.slice().sort((a,b)=>Number(a.score)-Number(b.score))[0]||{};
  const focusStatus=focus.latest_assessment_status||focus.latestAssessmentStatus||focus.status||'unknown';
  const performance=[...competencies].sort((a,b)=>Number(b.weight||0)-Number(a.weight||0)).slice(0,4);
  const trend=(pdata.trend||[]).filter(x=>x.after!==null&&x.after!==undefined);
  const trendPoints=trend.length?trend:[{after:score,before:score,created_at:null,competency_name:'当前综合'}];
  const points=trendPoints.map((x,i)=>{const xx=trendPoints.length===1?260:35+i*(450/Math.max(1,trendPoints.length-1));const yy=170-(Math.max(0,Math.min(100,Number(x.after||0)))/100)*120;return {x:Math.round(xx),y:Math.round(yy),v:x};});
  const linePath=points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ');
  const areaPath=points.length?`${linePath} L${points[points.length-1].x} 170 L${points[0].x} 170 Z`:'';
  const firstBefore=Number(trendPoints[0]?.before??trendPoints[0]?.after??score);const lastAfter=Number(trendPoints[trendPoints.length-1]?.after??score);const trendDelta=Math.round((lastAfter-firstBefore)*10)/10;
  const trendText=trendDelta>0?'持续上升':trendDelta<0?'近期回落':'保持稳定';
  const updatedText=pdata.updated_at?fmtDate(pdata.updated_at):'暂无更新事件';
  const compRows=competencies.map(c=>{const verify=c.latestAssessmentStatus||c.status||'unknown';return `<button class="profile-map-row" data-profile-session="${esc(pdata.latest_assessment?.session_id||'')}"><div><b>${esc(c.name)}</b><span>${STATUS[verify]||'待验证'}</span></div><div class="profile-map-bar"><i style="width:${Math.max(8,Math.min(100,c.score))}%"></i></div><strong>${Math.round(c.score)}</strong><span class="profile-map-arrow">→</span></button>`}).join('');
  const evidenceRows=visible.map(x=>`<button class="profile-evidence-row" data-profile-session="${esc(x.session_id||'')}"><span class="e-dot ${x.type}"></span><div><b>${esc(x.name||x.slot||'能力证据')}</b><p>${esc(x.detail||x.quote||'')}</p></div><span class="badge ${x.type}">${STATUS[x.type]||'待验证'}</span><em>${esc(x.tag||'岗位能力')}</em><small>${esc(x.date)}</small></button>`).join('');
  return `${pageHead('GLOBAL PROFILE','我的画像',`目标岗位 ${r.name} · 共 ${Number(stats.total||0)} 次有效记录 · 最近更新 ${updatedText}`)}
  <div class="profile-page">
    <section class="profile-top-grid">
      <article class="profile-due-card">
        <div class="profile-card-head"><div><span>当前待补证据</span><h2>${pending.length} 个关键项</h2></div><button class="primary" id="profile-train">去训练 →</button></div>
        <div class="profile-due-list">${due.length?due.map(x=>`<div><span class="e-dot ${x.type}"></span><b>${esc(x.name)}</b><small>${esc(x.tag)}</small></div>`).join(''):'<div><span class="e-dot verified"></span><b>当前最新评估没有待验证能力</b><small>继续训练保持证据新鲜度</small></div>'}</div>
        <p>待补项来自最近一次真实岗位评估；未覆盖能力只标记“待验证”，不会被直接算成低分。</p>
      </article>
      <article class="profile-stats-card">
        <div class="profile-card-head"><div><span>练习统计</span><h2>持续形成可验证能力证据</h2></div><button class="ghost" data-nav="drill">去练一场 →</button></div>
        <div class="profile-stats-grid"><div><span>有效记录</span><strong>${Number(stats.total||0)}</strong></div><div><span>综合画像分</span><strong>${Math.round(score)}</strong></div><div><span>最近评估分</span><strong>${stats.latest_score==null?'—':Math.round(Number(stats.latest_score))}<small>${stats.latest_score==null?'':'/100'}</small></strong></div><div><span>最近 7 天变化</span><strong class="${Number(stats.recent_change||0)>=0?'green':''}">${Number(stats.recent_change||0)>0?'+':''}${Number(stats.recent_change||0)}</strong></div></div>
        <div class="profile-stat-chips"><span>岗位评估 ${Number(stats.assessment_count||0)} 次${stats.assessment_average==null?'':` · 平均 ${Math.round(Number(stats.assessment_average))}`}</span><span>专项训练 ${Number(stats.drill_count||0)} 次${stats.drill_average==null?'':` · 平均 ${Math.round(Number(stats.drill_average))}`}</span><span>录音复盘 ${Number(stats.recording_count||0)} 次</span></div>
      </article>
    </section>

    <section class="profile-feature-card section">
      <div class="profile-section-title"><div><span>能力特征</span><h2>“你擅长什么、还缺什么”都由真实证据支撑</h2></div><button class="ghost" data-nav="report">查看评估报告</button></div>
      <div class="profile-focus-block"><div class="focus-icon">${svgIcon('target',18)}</div><div><span>当前焦点能力 · ${STATUS[focusStatus]||'待验证'}</span><h3>${esc(focus.name||'继续完成岗位评估')}</h3><p>${esc(focus.reason||focus.latest_reason||'当前没有足够数据确定新的焦点能力，继续完成评估即可。')}</p></div><div class="focus-score"><strong>${focus.score==null?'—':Math.round(Number(focus.score))}</strong><span>长期画像</span></div></div>

      <div class="profile-subsection-head"><div><span>Evidence 库</span><p>已获得项引用候选人原始回答；待补项来自最新评估缺口，不会伪造成 Evidence。</p></div><div class="profile-filter-tabs"><button class="${S.profile.evidenceFilter==='all'?'active':''}" data-profile-filter="all">全部 ${evidence.length}</button><button class="${S.profile.evidenceFilter==='verified'?'active':''}" data-profile-filter="verified">已验证 ${evidence.filter(x=>x.type==='verified').length}</button><button class="${S.profile.evidenceFilter==='partial'?'active':''}" data-profile-filter="partial">部分 ${evidence.filter(x=>x.type==='partial').length}</button><button class="${S.profile.evidenceFilter==='gap'?'active':''}" data-profile-filter="gap">待补 ${evidence.filter(x=>['gap','unknown'].includes(x.type)).length}</button></div></div>
      <div class="profile-evidence-list">${evidenceRows||'<div class="empty-state compact-empty"><div>✓</div><b>当前分类暂无证据</b><span>继续评估后会自动沉淀到这里。</span></div>'}</div>
      ${filtered.length>5?`<button class="profile-expand" id="profile-evidence-more">${S.profile.evidenceExpanded?'收起':'展开更多'} ${S.profile.evidenceExpanded?'↑':`(+${filtered.length-5}) ↓`}</button>`:''}

      <div class="profile-subsection-head map-head"><div><span>能力地图</span><p>长期画像分与最近一次评估验证状态同时展示。</p></div><span class="badge blue">${competencies.length} 个能力维度</span></div>
      <div class="profile-map-list">${compRows}</div>
    </section>

    <section class="profile-lower-grid section">
      <article class="card profile-performance-card">
        <div class="profile-section-title compact"><div><span>岗位能力</span><h2>当前高权重能力状态</h2></div><button class="ghost" data-nav="report">看详情</button></div>
        <div class="performance-grid">${performance.map(c=>`<div><span>${esc(c.name)}</span><strong>${(Number(c.score||0)/10).toFixed(1)}<small>/10</small></strong><div class="progress"><i style="width:${Math.max(4,Math.min(100,Number(c.score||0)))}%"></i></div></div>`).join('')}</div>
        <div class="profile-observation"><b>当前观察</b><p>${esc(focus.reason||'继续通过岗位评估和专项训练积累新证据，系统会按来源更新画像。')}</p></div>
      </article>

      <article class="card profile-trend-card">
        <div class="profile-section-title compact"><div><span>成长趋势</span><h2>最近 ${trend.length||1} 次画像事件</h2></div><button class="ghost" data-nav="history">全部记录</button></div>
        <div class="profile-trend-summary"><div><span>当前综合</span><strong>${Math.round(score)}</strong></div><div><span>事件变化</span><strong class="${trendDelta>=0?'green':''}">${trendDelta>0?'+':''}${trendDelta}</strong></div><div><span>趋势</span><strong class="${trendDelta>=0?'green':''}">${trendText}</strong></div></div>
        <div class="trend-chart"><svg viewBox="0 0 520 190" preserveAspectRatio="none" aria-label="真实画像事件趋势"><defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3b82f6" stop-opacity=".22"/><stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/></linearGradient></defs><g class="trend-grid"><line x1="25" y1="35" x2="500" y2="35"/><line x1="25" y1="80" x2="500" y2="80"/><line x1="25" y1="125" x2="500" y2="125"/><line x1="25" y1="170" x2="500" y2="170"/></g><path class="trend-area" d="${areaPath}"/><path class="trend-line" d="${linePath}"/><g class="trend-points">${points.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="${p===points[points.length-1]?5:4}"/>`).join('')}</g></svg><div class="trend-labels">${points.map(p=>`<span>${p.v.created_at?new Date(p.v.created_at).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'}):'当前'}</span>`).join('')}</div></div>
      </article>
    </section>

    <section class="card profile-events-card section">
      <div class="profile-section-title compact"><div><span>画像更新记录</span><h2>每一次分数变化都能追到来源</h2></div><button class="ghost" data-nav="history">查看全部记录</button></div>
      <div class="profile-event-grid">${events.length?events.slice(0,4).map(e=>`<button data-profile-session="${esc(e.sessionId||'')}"><span>${svgIcon('check',15)}</span><div><b>${esc(e.title)}</b><small>${esc(e.source)}</small><p>${esc(e.detail)}</p></div><i>查看来源 →</i></button>`).join(''):'<div class="empty-state compact-empty"><div>○</div><b>暂无画像更新事件</b><span>完成评估或训练后，真实变化会记录在这里。</span></div>'}</div>
    </section>
  </div>`;
}

const BASE_KNOWLEDGE_DOCS = [
  {id:'KB-JAVA-001',title:'Java 后端核心知识库',type:'核心知识',chunks:34,meta:'数据库 · 缓存 · 并发 · 微服务',updated:'今天 17:40',used:'专项训练 / 面试评分',desc:'岗位能力包的技术语义底座，包含机制解释、常见边界和评分参考。',size:'2.8 MB',snippets:['技术判断需要同时说明机制、约束、验证方法和失败边界。','引用知识时必须保留来源，只能用作标准和上下文，不能替代候选人的真实回答证据。']},
  {id:'PROJECT-001',title:'校园场地预约项目说明',type:'项目资料',chunks:12,meta:'项目背景 · 架构 · 量化结果',updated:'今天 18:06',used:'简历面试 / 成长 Agent',desc:'当前简历主项目的事实资料，帮助系统核对本人职责、方案取舍和结果。',size:'864 KB',snippets:['校园预约接口在高峰期出现慢查询，通过联合索引与 SQL 调整将平均响应从 420ms 降到 95ms。','本人主要负责预约接口、数据库查询优化和 Redis 热点缓存，并参与线上问题排查。']},
  {id:'JD-JAVA-001',title:'Java 后端目标岗位资料',type:'岗位资料',chunks:18,meta:'JD · 职责 · 技术栈 · 重点要求',updated:'今天 18:28',used:'JD 备面 / 岗位面试',desc:'目标岗位与公司相关资料，作为岗位理解、追问和匹配判断的上下文。',size:'1.2 MB',snippets:['岗位重点要求包含数据库性能优化、Redis 一致性和线上稳定性治理。','高优先级要求应优先进入面试验证，未覆盖能力保持“待验证”而不是按低分处理。']},
  {id:'NOTE-SQL-006',title:'SQL 性能优化复盘笔记',type:'核心知识',chunks:9,meta:'EXPLAIN · 联合索引 · 慢 SQL',updated:'09-06 21:10',used:'专项训练 / 证据补强',desc:'从专项训练沉淀的个人复盘资料，用于下一轮 SQL 相关追问和训练。',size:'326 KB',snippets:['联合索引设计要结合过滤条件、字段选择性和排序需求判断字段顺序。','优化完成后需要结合 EXPLAIN、平均耗时、P95/P99 和线上指标验证效果。']}
];

function loadKnowledgeStore(){
  try{
    const raw=JSON.parse(localStorage.getItem('zhidao-kb-store')||'null');
    if(raw&&typeof raw==='object') return {overrides:raw.overrides||{},custom:Array.isArray(raw.custom)?raw.custom:[]};
  }catch(e){}
  return {overrides:{},custom:[]};
}
function saveKnowledgeStore(store){ localStorage.setItem('zhidao-kb-store',JSON.stringify(store)); }
function knowledgeDocs(){
  return S.knowledge.loaded ? S.knowledge.docs : [];
}

function knowledge(){
  const docs=knowledgeDocs();
  const cats=['全部','核心知识','项目资料','岗位资料'];
  const q=S.knowledge.query.trim().toLowerCase();
  const cat=S.knowledge.category||'全部';
  const shown=docs.map((d,i)=>({d,i})).filter(x=>(cat==='全部'||x.d.type===cat)&&(!q||Object.values(x.d).join(' ').toLowerCase().includes(q)));
  const selectedIndex=S.knowledge.selected==null?(shown[0]?.i??null):S.knowledge.selected;
  const selected=selectedIndex==null?null:docs[selectedIndex];
  const editing=S.knowledge.editorId==='new'?{id:'',title:'',type:'核心知识',chunks:1,meta:'',updated:'刚刚',used:'专项训练 / 面试准备',desc:'',size:'手动创建',snippets:['','']}:S.knowledge.editorId?docs.find(d=>d.id===S.knowledge.editorId):null;
  const total=docs.reduce((n,d)=>n+d.chunks,0);
  const smartResults=Array.isArray(S.knowledge.searchResults)?S.knowledge.searchResults:[];
  const engineLabel=(S.knowledge.searchEngine||'').replace('lexical+embedding+reranker','关键词 + Qwen3 Embedding + Qwen3 Reranker').replace('lexical+no-vector+no-rerank','关键词检索').replace('lexical-v1','关键词检索');
  const smartPanel=q?`<section class="kb-smart-search"><div class="kb-smart-head"><div><span>${svgIcon('sparkles',14)}</span><div><b>智能片段检索</b><p>${S.knowledge.searching?'正在检索…':smartResults.length?`找到 ${smartResults.length} 个相关片段`:'没有找到高相关片段'}</p></div></div><em>${esc(engineLabel||'检索中')}</em></div><div class="kb-smart-results">${S.knowledge.searching?'<div class="kb-smart-loading">正在召回并重排知识片段…</div>':smartResults.map((x,i)=>`<button data-knowledge-source="${esc(x.document_id||'')}" class="kb-smart-item"><span>#${String(i+1).padStart(2,'0')}</span><div><b>${esc(x.title||x.document_id||'知识片段')}</b><p>${esc(x.text||'')}</p><small>source_id: ${esc(x.source_id||'')} · chunk ${Number(x.chunk_index??0)+1}</small></div><em>${Number.isFinite(Number(x.score))?Math.round(Number(x.score)*100)+'%':'相关'}</em></button>`).join('')||'<div class="kb-smart-loading">换一个更具体的关键词试试。</div>'}</div></section>`:'';
  return `<div class="kb-page">
    <input id="knowledge-file-input" type="file" accept=".pdf,.doc,.docx,.txt,.md" hidden>
    <section class="kb-hero">
      <div class="kb-hero-copy"><div class="eyebrow">KNOWLEDGE BASE</div><h1>知识库</h1><p>把岗位知识、项目事实和个人复盘放在一个地方。面试、训练和成长 Agent 都会优先引用这里的可信资料。</p></div>
      <div class="kb-hero-actions"><button class="ghost kb-action-btn kb-manual" id="knowledge-new"><span class="kb-btn-plus">+</span><span>新建知识点</span></button><button class="primary kb-action-btn kb-import" id="knowledge-import"><span class="kb-btn-plus">+</span><span>导入资料</span></button></div>
      <div class="kb-search">${svgIcon('book',16)}<input id="knowledge-search" value="${esc(S.knowledge.query)}" placeholder="搜索知识点、项目经历、JD 或资料标题"><span>⌘ K</span></div>
      <div class="kb-stats"><div><strong>${docs.length}</strong><span>资料</span></div><div><strong>${total}</strong><span>可引用片段</span></div><div><strong>5</strong><span>使用场景</span></div><div class="kb-index-state"><i></i><b>索引正常</b><span>全部资料可检索</span></div></div>
    </section>

    ${smartPanel}

    <div class="kb-workbench">
      <aside class="kb-sidebar">
        <div class="kb-side-title"><span>资料空间</span><h2>分类</h2></div>
        <div class="kb-categories">${cats.map(c=>`<button class="${cat===c?'active':''}" data-knowledge-category="${c}"><span>${c==='全部'?svgIcon('book',15):c==='核心知识'?svgIcon('target',15):c==='项目资料'?svgIcon('resume',15):svgIcon('briefcase',15)}</span><b>${c}</b><em>${c==='全部'?docs.length:docs.filter(d=>d.type===c).length}</em></button>`).join('')}</div>
        <div class="kb-side-divider"></div>
        <div class="kb-usage"><span>系统正在使用</span><div><i class="blue"></i><b>简历面试</b></div><div><i class="green"></i><b>专项训练</b></div><div><i class="orange"></i><b>JD 备面</b></div><div><i class="purple"></i><b>成长 Agent</b></div></div>
        <div class="kb-trace-note"><span>${svgIcon('sparkles',14)}</span><div><b>引用可追溯</b><p>问题、追问和评分会保留 source_id，后续可以回到原资料。</p></div></div>
      </aside>

      <main class="kb-library">
        <header class="kb-library-head"><div><span>当前空间</span><h2>${cat==='全部'?'全部资料':cat}</h2><p>${shown.length} 份资料 · 按最近更新排序</p></div><button class="kb-sort">最近更新 ↓</button></header>
        <div class="kb-doc-list">${shown.length?shown.map(({d,i})=>`<article class="kb-doc ${selectedIndex===i?'selected':''}" data-knowledge-view="${i}" tabindex="0">
          <div class="kb-doc-icon ${d.type==='核心知识'?'core':d.type==='项目资料'?'project':'job'}">${d.type==='核心知识'?'KB':d.type==='项目资料'?'PRJ':'JD'}</div>
          <div class="kb-doc-body"><div class="kb-doc-heading"><span>${d.type}</span><h3>${d.title}</h3></div><p>${d.desc}</p><div class="kb-doc-chips"><span>${d.chunks} 个片段</span>${d.meta.split(' · ').slice(0,3).map(x=>`<span>${x}</span>`).join('')}</div><div class="kb-doc-foot"><small>${d.id} · ${d.size}</small><small>${d.updated} 更新</small></div></div>
          <div class="kb-doc-state"><span><i></i> 已索引</span><b>→</b></div>
        </article>`).join(''):`<div class="kb-empty"><span>${svgIcon('book',20)}</span><b>没有匹配资料</b><p>换一个关键词或分类继续搜索。</p></div>`}<div id="knowledge-live-empty" class="kb-empty" style="display:none"><span>${svgIcon('book',20)}</span><b>没有匹配资料</b><p>换一个关键词继续搜索。</p></div></div>
      </main>

      <aside class="kb-detail ${selected?'open':''}">${selected?`
        <div class="kb-detail-head"><div class="kb-detail-headline"><div><span>${selected.type}</span><h2>${selected.title}</h2></div><button class="ghost kb-edit-btn" id="knowledge-edit" data-knowledge-edit="${selected.id}">编辑</button></div><p>${selected.desc}</p><div class="kb-source-id"><span>source_id</span><code>${selected.id}</code></div></div>
        <div class="kb-detail-meta"><div><span>内容规模</span><b>${selected.chunks} 个片段</b></div><div><span>文件大小</span><b>${selected.size}</b></div><div><span>最近更新</span><b>${selected.updated}</b></div></div>
        <section class="kb-detail-section"><div class="kb-detail-section-title"><span>代表性片段</span><b>可被面试与训练引用</b></div>${(selected.snippets||[]).slice(0,2).map((s,i)=>`<article class="kb-snippet"><div><span>#0${i+1}</span><em>${i===0?'高相关':'可引用'}</em></div><p>${esc(s)}</p></article>`).join('')}</section>
        <section class="kb-detail-section"><div class="kb-detail-section-title"><span>当前用于</span><b>上下文路由</b></div><div class="kb-use-tags">${selected.used.split(' / ').map(x=>`<span>${x}</span>`).join('')}</div></section>
        <div class="kb-detail-actions"><button class="secondary" data-nav="interview">用于面试准备</button><button class="ghost" data-nav="growth">交给成长 Agent</button></div>
      `:`<div class="kb-detail-empty"><span>${svgIcon('book',22)}</span><b>选择一份资料</b><p>右侧会展示 source_id、代表片段和它正在服务哪些能力。</p></div>`}</aside>
    </div>
    ${editing?`<div class="kb-editor-backdrop" id="knowledge-editor-backdrop"><section class="kb-editor-modal" role="dialog" aria-modal="true" aria-label="${S.knowledge.editorId==='new'?'新建知识点':'编辑知识点'}">
      <header class="kb-editor-head"><div><span>${S.knowledge.editorId==='new'?'NEW KNOWLEDGE':'EDIT KNOWLEDGE'}</span><h2>${S.knowledge.editorId==='new'?'新建知识点':'编辑知识点'}</h2><p>手动维护的内容同样会进入知识库检索，并保留独立 source_id。</p></div><button id="knowledge-editor-close" aria-label="关闭">×</button></header>
      <div class="kb-editor-body">
        <div class="kb-editor-grid"><div class="field"><label>知识点标题</label><input id="kb-edit-title" value="${esc(editing.title)}" placeholder="例如：Redis 缓存一致性处理"></div><div class="field"><label>分类</label><select id="kb-edit-type">${['核心知识','项目资料','岗位资料'].map(t=>`<option ${editing.type===t?'selected':''}>${t}</option>`).join('')}</select></div></div>
        <div class="field"><label>标签 <small>使用 · 分隔</small></label><input id="kb-edit-meta" value="${esc(editing.meta)}" placeholder="Redis · 一致性 · 缓存更新"></div>
        <div class="field"><label>说明</label><textarea id="kb-edit-desc" class="kb-editor-desc" placeholder="这条知识点主要解决什么问题？">${esc(editing.desc)}</textarea></div>
        <div class="kb-editor-section-title"><div><span>${svgIcon('book',14)}</span><div><b>正文片段</b><p>这些内容会作为可引用上下文进入训练、备面和 Agent。</p></div></div><button class="text-link" type="button" id="kb-editor-format">整理为面试知识点</button></div>
        <div class="field"><label>片段 01</label><textarea id="kb-edit-snippet-1" class="kb-editor-snippet" placeholder="输入核心知识、项目事实或岗位要求…">${esc(editing.snippets?.[0]||'')}</textarea></div>
        <div class="field"><label>片段 02 <small>可选</small></label><textarea id="kb-edit-snippet-2" class="kb-editor-snippet" placeholder="补充边界、案例、结论或验证方式…">${esc(editing.snippets?.[1]||'')}</textarea></div>
        <div class="kb-editor-tip"><span>${svgIcon('sparkles',14)}</span><div><b>建议写成可直接引用的事实或知识</b><p>比如“为什么这样做、适用什么条件、有什么边界、如何验证”，比只写关键词更适合后续面试使用。</p></div></div>
      </div>
      <footer class="kb-editor-footer"><button class="ghost" id="knowledge-editor-cancel">取消</button><button class="primary" id="knowledge-editor-save">保存知识点</button></footer>
    </section></div>`:''}
  </div>`;
}

function history(){
  const rows=(S.historyData?.items||[]).map(r=>({...r,time:r.created_at?new Date(r.created_at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'最近',score:r.score??'—'}));
  const filters=['全部','岗位评估','专项训练','JD 备面','录音复盘'];
  const shown=S.historyFilter==='全部'?rows:rows.filter(r=>r.type===S.historyFilter);
  return `${pageHead('HISTORY','历史记录','所有训练、备面、评估和真实面试复盘都会保留状态、结果与画像影响，不只是一个“看过就结束”的列表。')}
  <div class="history-overview"><div><span>累计记录</span><strong>${S.historyData?.summary?.total??rows.length}</strong><small>统一历史</small></div><div><span>已形成报告</span><strong>${S.historyData?.summary?.reports??0}</strong><small>可查看证据链</small></div><div><span>画像更新</span><strong>${S.historyData?.summary?.profile_events??0}</strong><small>有来源事件</small></div><div><span>已完成训练</span><strong class="green">${S.historyData?.summary?.completed_drills??0}</strong><small>可继续再评估</small></div></div>
  <section class="history-workbench"><div class="history-toolbar"><div class="filterbar">${filters.map(f=>`<button class="tab ${S.historyFilter===f?'active':''}" data-history-filter="${f}">${f}</button>`).join('')}</div><span>${shown.length} 条记录</span></div><div class="history-session-list">${shown.map(r=>`<article class="history-session-card"><div class="history-session-icon ${r.type==='专项训练'?'drill':r.type==='录音复盘'?'record':r.type==='JD 备面'?'job':'assessment'}">${r.type==='专项训练'?svgIcon('target',16):r.type==='录音复盘'?svgIcon('mic',16):r.type==='JD 备面'?svgIcon('briefcase',16):svgIcon('check',16)}</div><div class="history-session-main"><div class="history-session-title"><span>${esc(r.type)}</span><h3>${esc(r.title)}</h3></div><p>${esc(r.summary)}</p><div class="history-session-meta"><span>${esc(r.time)}</span><span>${esc(r.role)}</span><span>${esc(r.meta)}</span></div></div><div class="history-session-result"><span class="badge ${esc(r.tone)}">${esc(r.status)}</span><strong>${esc(r.score)}</strong><button class="secondary" data-history-open="${esc(r.type)}" data-history-id="${esc(r.id)}">查看详情 →</button></div></article>`).join('')}</div></section>`;
}

function agentResponse(query){
  const q=query.toLowerCase();
  if(q.includes('一周')||q.includes('计划')||q.includes('安排')) return {
    reply:'我结合你当前的岗位画像、最近评估和待验证证据，建议不要平均用力。先补 Redis 一致性和 SQL 量化验证，再做一轮完整岗位评估，最后根据新报告调整下一轮训练。',
    title:'未来 7 天岗位准备计划',
    plan:[
      {title:'补齐 Redis 一致性证据',desc:'失败补偿、高并发竞态、一致性边界',view:'drill',label:'开始训练'},
      {title:'完善当前 JD 能力映射',desc:'确认数据库、缓存、稳定性要求的优先级',view:'job',label:'去完善'},
      {title:'完成一轮 Java 岗位评估',desc:'用动态追问重新验证薄弱能力',view:'interview',label:'开始评估'},
      {title:'复核新评估报告',desc:'检查覆盖率、岗位匹配度和原始回答证据',view:'report',label:'查看报告'}
    ]
  };
  if(q.includes('jd')||q.includes('岗位')||q.includes('面试')||q.includes('准备')) return {
    reply:'可以。我已经读取当前简历和 Java 后端画像。现在最有效的路径是先确认这份 JD 真正在考什么，再针对证据缺口训练，随后直接进入岗位评估。',
    title:'Java 后端岗位准备流程',
    plan:[
      {title:'分析目标 JD',desc:'拆成能力指标、优先级和验证方式',view:'job',label:'分析 JD'},
      {title:'补强 Redis / SQL 薄弱项',desc:'根据当前画像优先补最影响匹配度的证据',view:'drill',label:'开始训练'},
      {title:'开始四阶段岗位评估',desc:'自我介绍 → 项目深挖 → 能力考察 → 总结反馈',view:'interview',label:'开始评估'},
      {title:'查看可审计评估结果',desc:'从分数回到问题、原回答和 Rubric',view:'report',label:'查看报告'}
    ]
  };
  if(q.includes('弱')||q.includes('补')||q.includes('画像')||q.includes('差')) return {
    reply:'从当前画像看，你不是“不会 Java”，而是部分关键能力的证据还不够完整。最值得优先补的是 Redis 一致性边界、SQL 优化的验证链路，以及线上故障定位的止损与复盘。',
    title:'当前能力缺口处理建议',
    plan:[
      {title:'查看能力画像证据',desc:'先确认哪些是已验证、部分验证和待验证',view:'profile',label:'查看画像'},
      {title:'针对 Redis 一致性训练',desc:'补充失败补偿和高并发边界',view:'drill',label:'去训练'},
      {title:'重新验证薄弱能力',desc:'通过正式评估获取新的回答证据',view:'interview',label:'重新评估'}
    ]
  };
  if(q.includes('报告')||q.includes('总结')||q.includes('分数')) return {
    reply:'最近一次 Java 后端评估的岗位匹配度约为 79%，评估覆盖率 81%。后端技术深度已经有比较完整的 SQL 优化证据，但 Redis 一致性与复杂故障定位仍会限制结论充分度。',
    title:'报告后的下一步',
    plan:[
      {title:'查看最近评估报告',desc:'定位扣分项对应的原始回答和 Rubric',view:'report',label:'打开报告'},
      {title:'训练最优先薄弱项',desc:'把报告里的缺口直接带入专项训练',view:'drill',label:'开始训练'},
      {title:'查看画像变化',desc:'确认训练与评估如何改变长期能力记录',view:'profile',label:'查看画像'}
    ]
  };
  return {
    reply:'我可以直接结合你的岗位、简历、画像、历史评估和知识库来回答，也可以帮你串联现有功能。你可以告诉我面试时间、目标 JD，或者直接说“我现在最该补什么”。',
    title:'推荐从这里开始',
    plan:[
      {title:'诊断当前能力缺口',desc:'从画像和最近评估中找出优先级最高的短板',view:'profile',label:'查看画像'},
      {title:'针对薄弱项训练',desc:'把缺口转换为可执行专项训练',view:'drill',label:'开始训练'}
    ]
  };
}

function agentActionView(type){
  return ({start_drill:'drill',review_job:'job',start_assessment:'interview',open_report:'report',open_profile:'profile',open_knowledge:'knowledge',review_history:'history'})[type]||'profile';
}
function agentActionLabel(type){
  return ({start_drill:'开始训练',review_job:'查看 JD',start_assessment:'开始评估',open_report:'查看报告',open_profile:'查看画像',open_knowledge:'打开知识库',review_history:'查看历史'})[type]||'去处理';
}
function normalizeAgentPlan(plan){
  return (plan?.actions||[]).map(a=>({
    id:a.id,type:a.type,title:a.label||'下一步',desc:a.reason||'',view:agentActionView(a.type),
    label:agentActionLabel(a.type),status:a.status==='done'?'done':'',payload:a.payload||{}
  }));
}
function applyAgentConversation(conv){
  if(!conv)return;
  S.agent.conversationId=conv.id||null;
  S.agent.activeConversation=conv.title||'新对话';
  S.agent.messages=(conv.messages||[]).map(m=>({...m,time:m.time||'已保存'}));
  S.agent.planTitle=conv.plan?.title||'';
  S.agent.plan=normalizeAgentPlan(conv.plan||{});
}

function growthAgent(){
  const r=role();
  const recent=(S.agent.conversations||[]).slice(0,6);
  const suggestions=[
    ['target','根据我的画像，告诉我现在最该补什么'],
    ['clock','帮我安排未来 7 天的 Java 面试准备'],
    ['briefcase','用当前简历和 JD 帮我规划一轮岗位评估'],
    ['check','总结最近报告，并告诉我为什么是这个分数']
  ];
  const coverage=Math.round((S.profile.data?.coverage||0)*100);
  const pending=Number(S.profile.data?.pending_count??0);
  const base=`<div class="agent-message assistant"><div class="agent-avatar">${svgIcon('sparkles',18)}</div><div class="agent-bubble"><div class="agent-message-meta"><b>成长 Agent</b><span>已连接你的成长资产</span></div><p>我已经读取当前目标岗位、简历、最近评估和长期画像。你目前准备的是 <strong>${r.name}</strong>，评估覆盖率 ${coverage}%${pending?`，还有 ${pending} 项能力需要继续验证`:''}。</p><div class="agent-context-scan"><span>${svgIcon('resume',13)} 简历已读取</span><span>${svgIcon('briefcase',13)} 岗位已连接</span><span>${svgIcon('user',13)} 画像已同步</span><span>${svgIcon('check',13)} 历史已读取</span></div></div></div>`;
  const messages=S.agent.messages.map(m=>`<div class="agent-message ${m.role}">${m.role==='assistant'?`<div class="agent-avatar">${svgIcon('sparkles',18)}</div>`:''}<div class="agent-bubble"><div class="agent-message-meta"><b>${m.role==='assistant'?'成长 Agent':'张同学'}</b><span>${m.time||'刚刚'}</span></div><p>${esc(m.text)}</p>${m.role==='assistant'&&m.source_ids?.length?`<div class="agent-context-scan agent-source-refs">${m.source_ids.slice(0,5).map(x=>`<span>${svgIcon('check',11)} ${esc(x)}</span>`).join('')}</div>`:''}</div>${m.role==='user'?'<div class="agent-user-avatar">张</div>':''}</div>`).join('');
  const plan=S.agent.plan.length?`<section class="agent-plan-card"><div class="agent-plan-head"><div><span>执行计划</span><h3>${esc(S.agent.planTitle)}</h3></div><span class="agent-plan-progress">${S.agent.plan.filter(x=>x.status==='done').length}/${S.agent.plan.length} 已完成</span></div><div class="agent-plan-list">${S.agent.plan.map((x,i)=>`<div class="agent-plan-step ${x.status||''}"><span class="agent-step-index">${x.status==='done'?'✓':String(i+1).padStart(2,'0')}</span><div><b>${esc(x.title)}</b><p>${esc(x.desc)}</p></div><button class="${i===0?'secondary':'ghost'}" data-agent-action="${x.view}" data-agent-step="${i}">${x.status==='done'?'已完成':esc(x.label||'去处理')}</button></div>`).join('')}</div><div class="agent-plan-footer"><span>计划会结合最新评估结果自动调整</span><button class="primary" id="agent-continue">继续执行 →</button></div></section>`:'';
  return `${pageHead('GROWTH AGENT','成长 Agent','不是另一个聊天机器人，而是整个求职闭环的总控入口：读取画像、简历、JD 与历史证据，给出计划并直接跳转执行。',`<div class="agent-head-badges"><span>${svgIcon('book',13)} 资料 · 4</span><span>${svgIcon('user',13)} 画像已同步</span><span>${svgIcon('sparkles',13)} 可执行任务</span></div>`)}
  <div class="growth-agent-page">
    <aside class="agent-history-panel">
      <button class="agent-new-chat" id="agent-new">＋ 新对话</button>
      <div class="agent-history-label">最近对话</div>
      <div class="agent-history-list">${recent.length?recent.map(x=>`<button class="${S.agent.conversationId===x.id?'active':''}" data-agent-conversation="${esc(x.id)}"><b>${esc(x.title||'新对话')}</b><span>${x.updated_at?new Date(x.updated_at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'最近'}</span></button>`).join(''):'<div class="agent-history-empty">暂无历史对话</div>'}</div>
      <div class="agent-history-label asset-label">工作资料</div>
      <div class="agent-asset-list"><button data-nav="resume"><span>${svgIcon('resume',14)}</span><div><b>当前简历</b><small>${esc(S.resume.fileName)}</small></div><i>→</i></button><button data-nav="job"><span>${svgIcon('briefcase',14)}</span><div><b>目标 JD</b><small>${r.name} · 已映射</small></div><i>→</i></button><button data-nav="knowledge"><span>${svgIcon('book',14)}</span><div><b>知识库</b><small>4 份资料 · 73 个片段</small></div><i>→</i></button></div>
      <div class="agent-source-card"><span>${svgIcon('sparkles',14)} 当前上下文</span><div><b>${r.name}</b><small>岗位匹配度 ${avg(r)}%</small></div><div><b>3 项待验证能力</b><small>Redis / 稳定性 / 学习适应</small></div><button data-nav="profile">查看画像 →</button></div>
    </aside>
    <section class="agent-chat-panel">
      <header class="agent-chat-head"><div><span class="agent-online"></span><div><b>${esc(S.agent.activeConversation)}</b><small>已连接简历、JD、知识库、报告与长期画像</small></div></div><button class="ghost" data-nav="knowledge">查看资料来源</button></header>
      <div class="agent-runtime-strip"><span>${svgIcon('resume',12)} 读简历</span><span>${svgIcon('briefcase',12)} 读 JD</span><span>${svgIcon('user',12)} 查画像</span><span>${svgIcon('target',12)} 发起训练</span><span>${svgIcon('check',12)} 查证据报告</span></div>
      <div class="agent-chat-body" id="agent-chat-body">${base}${messages}${S.agent.loading?`<div class="agent-message assistant agent-thinking"><div class="agent-avatar">${svgIcon('sparkles',18)}</div><div class="agent-bubble"><div class="agent-message-meta"><b>成长 Agent</b><span>正在分析</span></div><p>正在读取画像、历史记录与知识库证据，并生成可执行计划…</p></div></div>`:''}${plan}${!S.agent.messages.length&&!S.agent.loading?`<div class="agent-welcome"><div class="agent-welcome-icon">${svgIcon('sparkles',22)}</div><h3>直接告诉我你的目标</h3><p>我会先读取现有资料，再给出诊断、任务计划和可执行下一步，不需要你自己在页面之间来回找。</p><div class="agent-suggestions">${suggestions.map(([icon,text])=>`<button data-agent-prompt="${esc(text)}"><span>${svgIcon(icon,16)}</span><b>${text}</b><i>→</i></button>`).join('')}</div></div>`:''}</div>
      <footer class="agent-composer"><div class="agent-input-wrap"><textarea id="agent-input" rows="1" placeholder="例如：我周五要面 Java 后端，结合当前 JD 和画像帮我准备…"></textarea><button id="agent-send" aria-label="发送">${svgIcon('sparkles',17)}<span>发送</span></button></div><div class="agent-composer-tip"><span>Enter 发送 · Shift + Enter 换行</span><span>回答会引用当前证据，并可直接生成执行计划</span></div></footer>
    </section>
  </div>`;
}

function settings(){
  const ss=S.serverSettings||{};
  const assets=ss.assets||{};
  const ws=ss.workspace||{};
  const caps=Array.isArray(ss.capabilities)?ss.capabilities:[];
  const capEnabled=id=>caps.find(x=>x.id===id)?.enabled!==false;
  return `${pageHead('SETTINGS','设置','管理评估策略、个人数据和使用偏好。核心智能能力由系统统一提供，不需要用户配置底层服务。')}
  <div class="settings-page settings-page-v2">
    <section class="settings-main-card settings-preference-card">
      <div class="settings-card-head"><div><span>评估与训练</span><h2>使用偏好</h2><p>只调整你的训练与评估体验，不修改岗位标准和已经形成的历史证据。</p></div><span class="badge blue">个人偏好</span></div>
      <div class="settings-section-list">${settingRow('严格证据模式','评分结论必须绑定回答引用，无法核验的内容继续保留为待验证。',S.settings.evidenceStrict,'evidenceStrict','check')}${settingRow('训练结果自动回流','专项训练完成后自动生成 ProfileEvent，记录来源、变化和理由。',S.settings.autoProfile,'autoProfile','target')}${settingRow('面试辅助提示','练习时可展示提示、知识点与答题结构；正式评估仍以真实回答为准。',S.settings.hints,'hints','sparkles')}</div>
      <div class="settings-pref-foot"><span>${svgIcon('check',14)}</span><div><b>设置边界清晰</b><p>偏好只影响产品行为，岗位能力模型、Rubric 与历史证据不会被重写。</p></div></div>
    </section>

    <section class="settings-main-card settings-capability-card">
      <div class="settings-card-head"><div><span>智能能力</span><h2>系统能力已就绪</h2><p>核心能力由职到 AI 统一管理，会按岗位、会话和资料自动调用。</p></div><span class="badge verified">运行正常</span></div>
      <div class="engine-capability-list engine-capability-grid"><div><span>${svgIcon('briefcase',16)}</span><div><b>岗位与 JD 理解</b><p>拆解职责、能力指标、优先级和可追溯 JD 来源。</p></div><i>${capEnabled('jd')?'已启用':'未启用'}</i></div><div><span>${svgIcon('target',16)}</span><div><b>证据抽取与动态追问</b><p>识别已获得、缺失和矛盾证据，并决定下一步追问。</p></div><i>${capEnabled('evidence')?'已启用':'未启用'}</i></div><div><span>${svgIcon('check',16)}</span><div><b>可审计评分</b><p>结论关联原始回答、Rubric、判断理由与覆盖率。</p></div><i>${capEnabled('score')?'已启用':'未启用'}</i></div><div><span>${svgIcon('book',16)}</span><div><b>知识库检索</b><p>按 source_id 调用岗位资料、项目经历与个人复盘。</p></div><i>${capEnabled('rag')?'已启用':'未启用'}</i></div></div>
      <div class="settings-capability-note"><span>${svgIcon('sparkles',15)}</span><div><b>无需额外配置</b><p>底层智能服务已托管，你只需要使用产品能力本身。</p></div></div>
    </section>

    <section class="settings-data-card settings-assets-card">
      <div class="settings-card-head"><div><span>账号与数据</span><h2>你的成长资产</h2><p>简历、知识、画像和评估记录统一沉淀，所有入口都可以从这里直接管理。</p></div><span class="settings-card-meta">4 类资产</span></div>
      <div class="settings-data-grid"><div><span>${svgIcon('resume',16)}</span><div><b>当前简历</b><p>${esc(assets.resume_name||'尚未建立当前简历')} · Structured Resume</p></div><button class="ghost" data-nav="resume">管理</button></div><div><span>${svgIcon('book',16)}</span><div><b>知识库</b><p>${Number(assets.knowledge_documents??4)} 份资料 · ${Number(assets.knowledge_chunks??73)} 个可检索片段</p></div><button class="ghost" data-nav="knowledge">查看</button></div><div><span>${svgIcon('user',16)}</span><div><b>长期画像</b><p>${Number(assets.profile_events??0)} 条画像更新事件持续沉淀</p></div><button class="ghost" data-nav="profile">查看</button></div><div><span>${svgIcon('check',16)}</span><div><b>评估记录</b><p>报告与原始回答证据保留在历史记录中</p></div><button class="ghost" data-nav="history">查看</button></div></div>
      <div class="settings-data-actions"><input id="settings-import-file" type="file" accept=".json" hidden><div><b>数据备份</b><span>保留导入与导出入口，后端接入后可生成个人 JSON 备份。</span></div><button class="ghost" id="settings-import">导入数据</button><button class="secondary" id="settings-export">导出个人数据</button></div>
    </section>

    <section class="settings-status-card settings-workspace-card">
      <div class="settings-card-head"><div><span>系统状态</span><h2>当前工作区</h2><p>当前岗位、能力协议与知识索引的运行概况。</p></div><span class="settings-live"><i></i> 正常</span></div>
      <div class="settings-current-role"><span>${svgIcon('briefcase',17)}</span><div><small>当前岗位</small><b>${esc(role().name)}</b><p>能力包 ${esc(role().version||ws.role_pack_version||'v1.0')} · 证据协议${ws.evidence_protocol===false?'未启用':'已启用'}</p></div></div>
      <div class="settings-status-grid"><div><span>岗位模板</span><b>${Number(ws.role_templates??S.roles.length)}</b><small>可切换</small></div><div><span>知识索引</span><b>${Number(assets.knowledge_chunks??73)}</b><small>可检索片段</small></div><div><span>证据协议</span><b>${ws.evidence_protocol===false?'OFF':'ON'}</b><small>回答 → Rubric</small></div><div><span>画像同步</span><b>${esc(ws.profile_sync||'实时')}</b><small>训练结果回流</small></div></div>
      <div class="settings-version"><span>职到 AI · 岗位胜任力评估智能体</span><em>Evidence-grounded Assessment</em></div>
    </section>
  </div>`;
}
function settingRow(title,desc,val,key,icon='settings'){ return `<div class="setting-row"><span class="setting-row-icon">${svgIcon(icon,15)}</span><div><b>${title}</b><span>${desc}</span></div><button class="toggle ${val?'on':''}" data-setting="${key}" aria-label="${title}"><i></i></button></div>`; }

function renderView(){
  if(S.view==='home') return home();
  if(S.view==='resume') return resume();
  if(S.view==='job') return job();
  if(S.view==='interview') return interview();
  if(S.view==='drill') return drill();
  if(S.view==='graph') return questionGraph();
  if(S.view==='recording') return recording();
  if(S.view==='report') return report();
  if(S.view==='profile') return profile();
  if(S.view==='knowledge') return knowledge();
  if(S.view==='history') return history();
  if(S.view==='growth') return growthAgent();
  if(S.view==='settings') return settings();
  return home();
}

function notify(message){
  S.ui.toast=message;
  document.querySelector('.toast')?.remove();
  const host=document.querySelector('.app-shell');
  if(host) host.insertAdjacentHTML('beforeend',`<div class="toast show">${svgIcon('check',15)}<span>${esc(message)}</span></div>`);
  clearTimeout(notify.timer);
  notify.timer=setTimeout(()=>{document.querySelector('.toast')?.remove();S.ui.toast='';},1800);
}

function bind(){
  document.querySelectorAll('[data-nav]').forEach(el=>el.onclick=async()=>{const target=el.dataset.nav;S.view=target;if(target==='graph')await refreshQuestionGraph();if(target==='history')await refreshHistory();if(target==='growth')await Promise.all([refreshAgentConversations(),refreshProfile()]);if(target==='job')await refreshJobs();if(target==='report'){if(S.interview.sessionId){await refreshAssessmentReport();await refreshAudit(S.auditIndex??0);}else{const loaded=await loadLatestAssessmentReport();if(!loaded)notify('还没有已完成的岗位评估，先完成一轮面试训练');}}render();});
  document.querySelectorAll('[data-mode]').forEach(el=>el.onclick=()=>{ S.homeMode=el.dataset.mode; render(); });
  const hs=document.getElementById('home-start'); if(hs) hs.onclick=()=>{ const m=modeInfo(); if(m){S.view=m.view; render();} };
  const rs=document.getElementById('role-switch'); if(rs) rs.onchange=async e=>{S.roleId=e.target.value;localStorage.setItem('zhidao-role',S.roleId);localStorage.removeItem('zhidao-training-domain');resetDrillRun();S.graph.domain='';S.graph.node='';S.graph.scale=1;S.graph.focusRelated=false;S.graph.data=null;S.historyData=null;S.jobPrep.records=[];S.jobPrep.loaded=false;resetInterview();S.jdReady=false;S.jobPrep.reasonQuestion=null;S.dashboard=null;S.profile.data=null;S.reportData=null;S.auditData=null;await Promise.all([refreshDashboard(),refreshProfile(),refreshQuestionGraph(),refreshHistory(),refreshJobs()]);persistTrainingDomain(S.graph.domain||ROLE_DOMAIN_RECOMMENDATIONS[S.roleId]?.[0]||'sql');render();};

  const pnew=document.getElementById('prep-new'); if(pnew) pnew.onclick=()=>{S.jobPrep.screen='new';S.jobPrep.processing=false;S.jobPrep.company='';S.jobPrep.targetRole='';S.jobPrep.jd='';S.jobPrep.useResume=true;S.jobPrep.useProfile=true;render();};
  ['prep-back-list','prep-back-list-2'].forEach(id=>{const el=document.getElementById(id);if(el)el.onclick=()=>{S.jobPrep.screen='list';S.jobPrep.liveListening=false;render();};});
  document.querySelectorAll('[data-prep-filter]').forEach(el=>el.onclick=()=>{S.jobPrep.filter=el.dataset.prepFilter;render();});
  const psearch=document.getElementById('prep-search'); if(psearch){psearch.onchange=e=>{S.jobPrep.query=e.target.value;render();};psearch.onkeydown=e=>{if(e.key==='Enter'){S.jobPrep.query=e.target.value;render();}};}
  document.querySelectorAll('[data-prep-open]').forEach(el=>{el.onclick=e=>{if(e.target.closest('[data-prep-delete]'))return;S.jobPrep.selectedId=el.dataset.prepOpen;S.jobPrep.screen='detail';render();};el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();S.jobPrep.selectedId=el.dataset.prepOpen;S.jobPrep.screen='detail';render();}};});
  document.querySelectorAll('[data-prep-delete]').forEach(el=>el.onclick=async e=>{e.stopPropagation();const id=el.dataset.prepDelete;try{await apiRequest(`/jobs/${encodeURIComponent(id)}`,{method:'DELETE'});await refreshJobs();if(S.jobPrep.selectedId===id)S.jobPrep.selectedId=S.jobPrep.records[0]?.id||'';notify('准备记录已从后端删除');render();}catch(err){console.warn('job delete api unavailable',err);notify('删除失败，后端记录未发生变化');}});
  const prole=document.getElementById('jd-role'); if(prole) prole.oninput=e=>{S.jobPrep.targetRole=e.target.value;};
  const pprofile=document.getElementById('jd-use-profile'); if(pprofile) pprofile.onchange=e=>{S.jobPrep.useProfile=e.target.checked;};
  const pprocess=document.getElementById('prep-process'); if(pprocess) pprocess.onclick=async()=>{
    const company=(document.getElementById('jd-company')?.value||'').trim();
    const targetRole=(document.getElementById('jd-role')?.value||'').trim();
    const jd=(document.getElementById('jd')?.value||'').trim();
    if(!company){document.getElementById('jd-company')?.focus();notify('请先填写目标公司');return;}
    if(!targetRole){document.getElementById('jd-role')?.focus();notify('请先填写目标岗位');return;}
    if(jd.length<50){document.getElementById('jd')?.focus();notify('岗位 JD 建议至少填写 50 字');return;}
    S.jobPrep.company=company;S.jobPrep.targetRole=targetRole;S.jobPrep.jd=jd;S.jobPrep.useResume=document.getElementById('jd-use-resume')?.checked!==false;S.jobPrep.useProfile=document.getElementById('jd-use-profile')?.checked!==false;S.jobPrep.processing=true;render();
    try{
      const analyzed=await apiRequest('/jobs/analyze',{method:'POST',body:JSON.stringify({role_id:S.roleId,company,role_name:targetRole,raw_jd:jd,resume_id:S.activeResume?.id||null,use_resume:S.jobPrep.useResume})});
      await refreshJobs();
      S.jobPrep.selectedId=analyzed.job_analysis_id;
      S.jobPrep.processing=false;
      S.jobPrep.screen='detail';
      S.jdReady=true;
      notify('岗位分析已完成并保存');
      render();
    }catch(err){
      console.error(err);S.jobPrep.processing=false;notify('岗位分析失败，请稍后重试');render();
    }
  };
  const psave=document.getElementById('prep-save'); if(psave) psave.onclick=()=>notify('准备记录已保存');
  const openLive=()=>{S.jobPrep.screen='live';S.jobPrep.liveListening=false;render();};
  ['prep-live','prep-live-2'].forEach(id=>{const el=document.getElementById(id);if(el)el.onclick=openLive;});
  const ltoggle=document.getElementById('live-toggle'); if(ltoggle) ltoggle.onclick=()=>{S.jobPrep.liveListening=!S.jobPrep.liveListening;render();};
  const lexit=document.getElementById('live-exit'); if(lexit) lexit.onclick=()=>{S.jobPrep.liveListening=false;S.jobPrep.screen='detail';render();};

  const jdBox=document.getElementById('jd'); if(jdBox) jdBox.oninput=e=>{S.jobPrep.jd=e.target.value;const c=document.getElementById('jd-count');if(c)c.textContent=`${e.target.value.length} 字`;};
  const jdCompany=document.getElementById('jd-company'); if(jdCompany) jdCompany.oninput=e=>{S.jobPrep.company=e.target.value;};
  const jdResume=document.getElementById('jd-use-resume'); if(jdResume) jdResume.onchange=e=>{S.jobPrep.useResume=e.target.checked;};
  const aj=document.getElementById('analyze-jd'); if(aj) aj.onclick=()=>{const text=(document.getElementById('jd')?.value||S.jobPrep.jd||'').trim();S.jobPrep.company=(document.getElementById('jd-company')?.value||S.jobPrep.company||'').trim();S.jobPrep.useResume=document.getElementById('jd-use-resume')?.checked!==false;if(text.length<50){document.getElementById('jd')?.focus();notify('请粘贴更完整的岗位 JD，建议至少 50 字');return;}S.jobPrep.jd=text;S.jdReady=true;S.jobPrep.reasonQuestion=null;notify('岗位要求分析完成');render();};
  const jed=document.getElementById('jd-edit'); if(jed) jed.onclick=()=>{S.jdReady=false;render();setTimeout(()=>document.getElementById('jd')?.focus(),0);};
  const startJobFromPrep=async()=>{const prep=currentJobPrep();if(!prep?.id){notify('请先完成一次岗位分析');return;}resetInterview();S.interview.sourceMode='job';S.interview.company=prep.company||S.jobPrep.company;S.interview.targetRole=prep.role||role().name;S.interview.jobJD=prep.jd||S.jobPrep.jd;S.interview.useResume=prep.resume!==false;try{await createAssessmentSession('job',prep.id);S.view='interview';render();}catch(err){console.error(err);notify('岗位面试启动失败，请稍后重试');}};
  ['prep-assess','prep-assess-2'].forEach(id=>{const el=document.getElementById(id);if(el)el.onclick=startJobFromPrep;});
  ['jd-gap-train','jd-gap-train-2'].forEach(id=>{const el=document.getElementById(id);if(el)el.onclick=()=>{const id2=S.roleId==='java-backend'?'middleware':recommendedDomains()[0]||'sql';persistTrainingDomain(id2);S.drill.source=`JD 备面：${role().name} 证据缺口`;resetDrillRun();S.view='drill';render();};});
  document.querySelectorAll('[data-jd-question]').forEach(el=>el.onclick=()=>{const i=Number(el.dataset.jdQuestion);S.jobPrep.reasonQuestion=S.jobPrep.reasonQuestion===i?null:i;render();});
  document.querySelectorAll('[data-jd-practice]').forEach(el=>el.onclick=()=>{persistTrainingDomain(competencyToTopic(el.dataset.jdPractice));S.drill.source=`JD 备面：${role().name} · ${el.dataset.jdPractice}`;resetDrillRun();S.view='drill';render();});
  document.querySelectorAll('[data-interview-source]').forEach(el=>el.onclick=()=>{S.interview.sourceMode=el.dataset.interviewSource;render();});
  const ijd=document.getElementById('interview-job-jd'); if(ijd) ijd.oninput=e=>{S.interview.jobJD=e.target.value;const c=document.getElementById('interview-jd-count');if(c)c.textContent=`${e.target.value.length} 字`;};
  const icomp=document.getElementById('interview-company'); if(icomp) icomp.oninput=e=>{S.interview.company=e.target.value;};
  const irole=document.getElementById('interview-target-role'); if(irole) irole.oninput=e=>{S.interview.targetRole=e.target.value;};
  const iresume=document.getElementById('interview-use-resume'); if(iresume) iresume.onchange=e=>{S.interview.useResume=e.target.checked;};
  const istart=document.getElementById('interview-start'); if(istart) istart.onclick=async()=>{try{if(S.interview.sourceMode==='job'){const target=(document.getElementById('interview-target-role')?.value||S.interview.targetRole||'').trim();const jd=(document.getElementById('interview-job-jd')?.value||S.interview.jobJD||'').trim();S.interview.company=(document.getElementById('interview-company')?.value||S.interview.company||'').trim();S.interview.targetRole=target;S.interview.jobJD=jd;S.interview.useResume=document.getElementById('interview-use-resume')?.checked!==false;if(!target){document.getElementById('interview-target-role')?.focus();notify('请先填写目标岗位');return;}if(jd.length<50){document.getElementById('interview-job-jd')?.focus();notify('岗位 JD 建议至少填写 50 字');return;}S.jdReady=true;notify('正在分析岗位要求并创建面试…');const job=await apiRequest('/jobs/analyze',{method:'POST',body:JSON.stringify({role_id:S.roleId,company:S.interview.company,role_name:target,raw_jd:jd,resume_id:S.activeResume?.id||null,use_resume:S.interview.useResume})});await refreshJobs();await createAssessmentSession('job',job.job_analysis_id);}else{await createAssessmentSession('resume',null);}render();}catch(err){console.error(err);notify('面试创建失败，请稍后重试');}};
  const answerBox=document.getElementById('answer'); if(answerBox) answerBox.oninput=e=>{const idx=S.interview.index;S.interview.drafts[idx]=e.target.value;const c=document.getElementById('answer-count');if(c)c.textContent=`${e.target.value.length} 字 · 建议 80–300 字`;const d=document.getElementById('draft-state');if(d)d.textContent='草稿有更新，尚未提交为正式证据';};
  const isave=document.getElementById('interview-save'); if(isave) isave.onclick=()=>{const idx=S.interview.index;S.interview.drafts[idx]=document.getElementById('answer')?.value||'';const d=document.getElementById('draft-state');if(d)d.textContent='草稿已保存';notify('当前回答草稿已保存');};
  const iskip=document.getElementById('interview-skip'); if(iskip) iskip.onclick=async()=>{const qs=currentInterviewQuestions();const idx=S.interview.index;const q=qs[idx];S.interview.skipped[idx]=true;S.interview.answers[idx]='[SKIPPED]';S.interview.drafts[idx]='';if(S.interview.sessionId&&q?.id){try{const result=await apiRequest(`/assessments/${encodeURIComponent(S.interview.sessionId)}/skip`,{method:'POST',body:JSON.stringify({question_id:q.id})});if(result.next_question){appendBackendQuestion(result.next_question);S.interview.index=S.interview.backendQuestions.findIndex(x=>x.id===result.next_question.id);render();return;}await finishCurrentAssessment('skipped_last');render();return;}catch(err){console.warn('assessment skip api unavailable',err);}}if(idx<qs.length-1){S.interview.index++;render();}else{S.view='report';S.auditIndex=0;render();}};
  const iend=document.getElementById('interview-end'); if(iend) iend.onclick=async()=>{if(iend.disabled)return;iend.disabled=true;const old=iend.textContent;iend.textContent='正在生成报告…';try{await finishCurrentAssessment('user_ended');notify('已结束本轮面试，未完成能力保持待验证');render();}catch(err){console.warn('assessment finish api unavailable',err);iend.disabled=false;iend.textContent=old;notify('结束面试失败，请稍后重试');}};
  const as=document.getElementById('answer-submit'); if(as) as.onclick=async()=>{if(as.disabled)return;const qs=currentInterviewQuestions();const ta=document.getElementById('answer');const text=(ta?.value||'').trim();if(!text){ta?.focus();notify('请先回答当前问题，或选择“稍后回答”');return;}as.disabled=true;if(iend)iend.disabled=true;const old=as.textContent;as.textContent='正在分析证据…';const idx=S.interview.index;const q=qs[idx];S.interview.answers[idx]=text;S.interview.drafts[idx]='';S.interview.skipped[idx]=false;if(S.interview.sessionId&&q?.id){try{const result=await apiRequest(`/assessments/${encodeURIComponent(S.interview.sessionId)}/answers`,{method:'POST',body:JSON.stringify({question_id:q.id,text})});S.interview.lastEvidence=result.evidence||null;if(result.decision?.type==='followup'&&result.next_question){S.interview.gap=(result.evidence?.missing||result.next_question.evidence_targets||[]);S.interview.followupQuestion=result.next_question;render();return;}S.interview.gap=null;S.interview.followupQuestion=null;if(result.next_question){appendBackendQuestion(result.next_question);S.interview.index=S.interview.backendQuestions.findIndex(x=>x.id===result.next_question.id);render();return;}await finishCurrentAssessment('completed');render();return;}catch(err){console.warn('assessment answer api unavailable',err);as.disabled=false;as.textContent=old;notify('回答提交失败，请稍后重试');return;}}const gap=idx===1&&!S.interview.resolved?detectGap(text):null;if(gap){S.interview.gap=gap;render();return;}if(idx<qs.length-1){S.interview.index++;render();}else{S.view='report';S.auditIndex=0;render();}};
  const fs=document.getElementById('follow-submit'); if(fs) fs.onclick=async()=>{if(fs.disabled)return;const text=(document.getElementById('follow-answer')?.value||'').trim();if(!text){document.getElementById('follow-answer')?.focus();notify('请先补充当前缺失证据');return;}fs.disabled=true;const old=fs.textContent;fs.textContent='正在核验证据…';const idx=S.interview.index;const fq=S.interview.followupQuestion;if(S.interview.sessionId&&fq?.id){try{const result=await apiRequest(`/assessments/${encodeURIComponent(S.interview.sessionId)}/answers`,{method:'POST',body:JSON.stringify({question_id:fq.id,text})});S.interview.answers[idx]=(S.interview.answers[idx]||'')+'\n补充：'+text;S.interview.lastEvidence=result.evidence||null;if(result.decision?.type==='followup'&&result.next_question){S.interview.gap=(result.evidence?.missing||result.next_question.evidence_targets||[]);S.interview.followupQuestion=result.next_question;render();return;}S.interview.gap=null;S.interview.followupQuestion=null;S.interview.resolved=true;if(result.next_question){appendBackendQuestion(result.next_question);S.interview.index=S.interview.backendQuestions.findIndex(x=>x.id===result.next_question.id);render();return;}await finishCurrentAssessment('completed');render();return;}catch(err){console.warn('assessment followup api unavailable',err);fs.disabled=false;fs.textContent=old;notify('补充证据提交失败，请稍后重试');return;}}S.interview.answers[idx]=(S.interview.answers[idx]||'')+'\n补充：'+text;S.interview.gap=null;S.interview.resolved=true;S.interview.index=Math.min(idx+1,currentInterviewQuestions().length-1);render();};
  document.querySelectorAll('[data-topic]').forEach(el=>el.onclick=()=>{persistTrainingDomain(el.dataset.topic);resetDrillRun();render();});
  document.querySelectorAll('[data-graph-domain]').forEach(el=>el.onclick=()=>{persistTrainingDomain(el.dataset.graphDomain);S.graph.node='';S.graph.focusRelated=false;S.graph.scale=1;render();});
  document.querySelectorAll('[data-graph-node]').forEach(el=>el.onclick=()=>{S.graph.node=el.dataset.graphNode;render();});
  const glt=document.getElementById('graph-legend-toggle'); if(glt) glt.onclick=()=>{S.graph.legendOpen=!S.graph.legendOpen;render();};
  const glc=document.getElementById('graph-legend-close'); if(glc) glc.onclick=()=>{S.graph.legendOpen=false;render();};
  const gzi=document.getElementById('graph-zoom-in'); if(gzi) gzi.onclick=()=>{S.graph.scale=Math.min(1.35,Math.round((S.graph.scale+.1)*10)/10);render();};
  const gzo=document.getElementById('graph-zoom-out'); if(gzo) gzo.onclick=()=>{S.graph.scale=Math.max(.75,Math.round((S.graph.scale-.1)*10)/10);render();};
  const gc=document.getElementById('graph-center'); if(gc) gc.onclick=()=>{S.graph.scale=1;render();};
  const gf=document.getElementById('graph-focus-node'); if(gf) gf.onclick=()=>{S.graph.focusRelated=!S.graph.focusRelated;render();};
  const god=document.getElementById('graph-open-domain-drill'); if(god) god.onclick=()=>{persistTrainingDomain(S.graph.domain);resetDrillRun();S.drill.topic=S.graph.domain;S.drill.source='题目图谱：当前领域';S.view='drill';render();};
  const gtrain=document.getElementById('graph-train-node'); if(gtrain) gtrain.onclick=async()=>{const n=graphNodeById(S.graph.node);const gd=graphDomainData(n.topic);const gq=gd?.questions?.find(x=>x.index===n.q);persistTrainingDomain(n.topic);resetDrillRun();S.drill.topic=n.topic;S.drill.source=`题目图谱：${n.label}`;try{const session=await apiRequest('/drills',{method:'POST',body:JSON.stringify({role_id:S.roleId,topic:gq?.backend_topic||backendDrillTopic(n.topic),competency_id:n.competency_id||gq?.competency_id||null,source:'graph',source_ref_id:n.question_id||gq?.id||n.id,count:drillQuestions(n.topic).length})});S.drill.sessionId=session.id;}catch(err){console.warn('graph drill create api unavailable',err);}S.drill.started=true;S.drill.index=n.q;S.view='drill';render();};
  const gcDomain=document.getElementById('graph-create-domain'); if(gcDomain) gcDomain.onclick=()=>{S.drill.createOpen=true;S.view='drill';render();};
  const dcOpen=document.getElementById('domain-create-open'); if(dcOpen) dcOpen.onclick=()=>{S.drill.createOpen=true;render();};
  const closeDomainModal=()=>{S.drill.createOpen=false;render();};
  ['domain-create-close','domain-create-cancel'].forEach(id=>{const el=document.getElementById(id);if(el)el.onclick=closeDomainModal;});
  const dmb=document.getElementById('domain-modal-backdrop'); if(dmb) dmb.onclick=e=>{if(e.target===dmb)closeDomainModal();};
  const dsave=document.getElementById('domain-create-save'); if(dsave) dsave.onclick=()=>{const name=(document.getElementById('domain-name')?.value||'').trim();const desc=(document.getElementById('domain-desc')?.value||'').trim();const tags=(document.getElementById('domain-tags')?.value||'').split(/[,，]/).map(x=>x.trim()).filter(Boolean).slice(0,4);if(!name){document.getElementById('domain-name')?.focus();notify('请填写领域名称');return;}const base=name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g,'-').replace(/^-|-$/g,'')||`domain-${Date.now()}`;let id=base;while(allTrainingDomains().some(d=>d.id===id))id=`${base}-${Math.floor(Math.random()*99)+1}`;const domain={id,name,meta:'自定义领域',score:60,due:'自定义',mark:name.slice(0,2),desc:desc||`围绕 ${name} 的核心知识、高频问题与工程实践进行专项训练`,tags:tags.length?tags:['核心知识','高频题','工程实践']};S.customDomains.push(domain);localStorage.setItem('zhidao-custom-domains',JSON.stringify(S.customDomains));persistTrainingDomain(id);S.graph.node='';S.drill.createOpen=false;resetDrillRun();notify(`已创建领域：${name}`);render();};
  const ds=document.getElementById('drill-start'); if(ds) ds.onclick=async()=>{const topic=S.drill.topic;const source=S.drill.source||'自主专项训练';resetDrillRun();S.drill.topic=topic;S.drill.source=source;try{const session=await apiRequest('/drills',{method:'POST',body:JSON.stringify({role_id:S.roleId,topic:backendDrillTopic(topic),source:source==='自主专项训练'?'manual':'linked',source_ref_id:source,count:drillQuestions(topic).length})});S.drill.sessionId=session.id;}catch(err){console.warn('drill create api unavailable',err);notify('后端训练会话暂不可用，已切换本地训练');}S.drill.started=true;render();};
  const db=document.getElementById('drill-back'); if(db) db.onclick=()=>{resetDrillRun();render();};
  const db2=document.getElementById('drill-back-2'); if(db2) db2.onclick=()=>{resetDrillRun();render();};
  const dsub=document.getElementById('drill-submit'); if(dsub) dsub.onclick=async()=>{const ta=document.getElementById('drill-answer');const text=(ta?.value||'').trim();if(!text){ta?.focus();notify('先写下你的思路，再提交分析');return;}const idx=S.drill.index;S.drill.answers[idx]=text;let usedApi=false;if(S.drill.sessionId){try{const result=await apiRequest(`/drills/${encodeURIComponent(S.drill.sessionId)}/attempts`,{method:'POST',body:JSON.stringify({question_index:idx,text})});S.drill.scores[idx]=Number(result.score);S.drill.feedbacks[idx]=result.feedback||null;usedApi=true;}catch(err){console.warn('drill attempt api unavailable',err);}}if(!usedApi){const depth=Math.min(10,Math.floor(text.length/45));S.drill.scores[idx]=Math.min(94,74+((idx*3)%9)+depth);}S.drill.submitted=true;render();};
  document.querySelectorAll('[data-drill-help]').forEach(el=>el.onclick=()=>{S.drill.help=S.drill.help===el.dataset.drillHelp?null:el.dataset.drillHelp;render();});
  const dskip=document.getElementById('drill-skip'); if(dskip) dskip.onclick=()=>{const bank=drillQuestions(S.drill.topic);S.drill.answers[S.drill.index]='';S.drill.scores[S.drill.index]=null;S.drill.submitted=false;S.drill.help=null;if(S.drill.index>=bank.length-1)S.drill.finished=true;else S.drill.index++;render();};
  const dnext=document.getElementById('drill-next'); if(dnext) dnext.onclick=()=>{const bank=drillQuestions(S.drill.topic);S.drill.submitted=false;S.drill.help=null;if(S.drill.index>=bank.length-1)S.drill.finished=true;else S.drill.index++;render();};
  const dend=document.getElementById('drill-end'); if(dend) dend.onclick=()=>{S.drill.finished=true;render();};
  const drestart=document.getElementById('drill-restart'); if(drestart) drestart.onclick=()=>{S.drill.index=0;S.drill.answers=[];S.drill.scores=[];S.drill.submitted=false;S.drill.help=null;S.drill.finished=false;render();};
  const dc=document.getElementById('drill-complete'); if(dc) dc.onclick=async()=>{const t=drillTopics().find(x=>x.id===S.drill.topic)||drillTopics()[0];const valid=S.drill.scores.filter(x=>Number.isFinite(x));const a=valid.length?Math.round(valid.reduce((x,y)=>x+y,0)/valid.length):t.score;let before=t.score,after=Math.max(t.score,Math.min(92,a)),serverEvent=null;if(S.drill.sessionId){try{const result=await apiRequest(`/drills/${encodeURIComponent(S.drill.sessionId)}/finish`,{method:'POST',body:JSON.stringify({reason:'completed'})});serverEvent=result.profile_event||null;if(serverEvent){before=Number(serverEvent.before??before);after=Number(serverEvent.after??after);}await Promise.all([refreshDashboard(),refreshProfile()]);}catch(err){console.warn('drill finish api unavailable',err);}}const total=drillQuestions(t.id).length;if(!serverEvent)S.events.unshift({title:`${t.meta} ${before} → ${after}`,source:`${role().name} · 专项训练 · 刚刚`,detail:`完成“${t.name}”${total} 题训练，本轮回答 ${S.drill.answers.filter(Boolean).length} 题，新增可核验训练证据。`});resetDrillRun();S.view='profile';render();};
  document.querySelectorAll('[data-record-mode]').forEach(el=>el.onclick=()=>{S.recording.mode=el.dataset.recordMode;S.recording.recordId=null;S.recording.analysis=null;S.recording.segments=[];S.recording.transcriptionMeta=null;S.recording.analyzed=false;S.recordingAnalyzed=false;render();});
  document.querySelectorAll('[data-record-input]').forEach(el=>el.onclick=()=>{S.recording.input=el.dataset.recordInput;S.recording.recordId=null;S.recording.analysis=null;S.recording.segments=[];S.recording.transcriptionMeta=null;S.recording.transcribed=false;S.recording.analyzed=false;S.recordingAnalyzed=false;S.recording.transcribing=false;if(S.recording.input==='audio')S.recording.text='';render();});
  const rc=document.getElementById('record-company'); if(rc) rc.oninput=e=>{S.recording.company=e.target.value;};
  const rr2=document.getElementById('record-role'); if(rr2) rr2.oninput=e=>{S.recording.role=e.target.value;};
  const rtext=document.getElementById('record-text'); if(rtext) rtext.oninput=e=>{S.recording.text=e.target.value;};
  const rtrans=document.getElementById('record-transcribe'); if(rtrans) rtrans.onclick=async()=>{const f=S.recording.file;if(!f){notify('请重新选择本地录音文件');return;}if(S.recording.transcribing)return;S.recording.company=(document.getElementById('record-company')?.value||S.recording.company||'').trim();S.recording.role=(document.getElementById('record-role')?.value||S.recording.role||'').trim();S.recording.transcribing=true;S.recording.analyzed=false;S.recording.analysis=null;render();try{const pcm=await audioFileToPcm16k(f);const fd=new FormData();fd.append('file',new File([pcm],'recording.pcm',{type:'application/octet-stream'}));fd.append('original_name',f.name);fd.append('mode',S.recording.mode);fd.append('company',S.recording.company);fd.append('role_name',S.recording.role);const transcribed=await apiRequest('/recordings/transcribe',{method:'POST',body:fd});S.recording.recordId=transcribed.id;S.recording.text=transcribed.raw_text||'';S.recording.segments=transcribed.segments||[];S.recording.transcriptionMeta=transcribed.analysis?.transcription||null;S.recording.transcribed=!!S.recording.text;S.recording.transcribing=false;render();setTimeout(()=>notify(`讯飞转写完成：${S.recording.text.length} 字，请先核对文本`),0);}catch(err){console.error(err);S.recording.transcribing=false;const msg=err.message==='speech_not_configured'?'讯飞 ASR 尚未配置到后端环境':err.message==='audio_over_10_minutes'?'当前网页上传先限制 10 分钟以内':err.message==='speech_connect_failed'?'讯飞转写服务连接失败，请稍后重试':'转写失败，请检查音频格式或服务配置';render();setTimeout(()=>notify(msg),0);}};
  const ra=document.getElementById('record-analyze'); if(ra) ra.onclick=async()=>{const text=(document.getElementById('record-text')?.value||S.recording.text||'').trim();if(!text){notify('请先准备可分析文本');return;}S.recording.text=text;S.recording.transcribed=true;try{let id=S.recording.recordId;if(!id){const created=await apiRequest('/recordings',{method:'POST',body:JSON.stringify({mode:S.recording.mode,company:S.recording.company,role_name:S.recording.role,raw_text:text})});id=created.id;S.recording.recordId=id;}const analyzed=await apiRequest(`/recordings/${encodeURIComponent(id)}/analyze`,{method:'POST',body:JSON.stringify({raw_text:text})});S.recording.analysis=analyzed.analysis||null;S.recording.analyzed=true;S.recordingAnalyzed=true;render();setTimeout(()=>notify('复盘完成，原始回答与 Evidence 已保存'),0);}catch(err){console.warn('recording analyze api unavailable',err);S.recording.analyzed=true;S.recordingAnalyzed=true;render();setTimeout(()=>notify('后端复盘暂不可用，已保留当前文本'),0);}};
  const rtrain=document.getElementById('record-train'); if(rtrain) rtrain.onclick=()=>{persistTrainingDomain('middleware');S.drill.source=`录音复盘：${S.recording.recordId||'当前会话'} · Evidence 缺口`;resetDrillRun();S.view='drill';render();};
  const rprofile=document.getElementById('record-profile'); if(rprofile) rprofile.onclick=async()=>{let serverEvents=[];if(S.recording.recordId){try{const result=await apiRequest(`/recordings/${encodeURIComponent(S.recording.recordId)}/sync-profile`,{method:'POST',body:JSON.stringify({role_id:S.roleId})});serverEvents=result.profile_events||[];await Promise.all([refreshDashboard(),refreshProfile()]);}catch(err){console.warn('recording profile sync unavailable',err);}}if(serverEvents.length){notify('录音证据已写入长期画像');}else{S.events.unshift({title:'录音复盘证据已整理',source:'录音复盘 · 刚刚',detail:'当前复盘结果已保留，后续可以继续通过专项训练补充证据。'});}S.view='profile';render();};
  document.querySelectorAll('[data-audit]').forEach(el=>el.onclick=async()=>{S.auditIndex=Number(el.dataset.audit);S.auditData=null;if(S.interview.sessionId)await refreshAudit(S.auditIndex);render();});
  const reportTrain=()=>{const comps=S.reportData?.competencies||[];const target=[...comps].sort((a,b)=>{const ap=a.status==='unknown'?0:1,bp=b.status==='unknown'?0:1;if(ap!==bp)return ap-bp;return Number(a.score??999)-Number(b.score??999);})[0];const topic=competencyToTopic(target?.competency_id||'reliability');persistTrainingDomain(topic);S.drill.source=`评估报告：${target?.name||'薄弱能力'} · ${target?.status==='unknown'?'待验证':'证据不足'}`;resetDrillRun();S.view='drill';render();};
  const rt=document.getElementById('report-train'); if(rt) rt.onclick=reportTrain;
  const rt2=document.getElementById('report-train-2'); if(rt2) rt2.onclick=reportTrain;
  document.querySelectorAll('[data-setting]').forEach(el=>el.onclick=async()=>{const k=el.dataset.setting;const before=S.settings[k];const next=!before;S.settings[k]=next;render();try{S.serverSettings=await apiRequest('/settings',{method:'PATCH',body:JSON.stringify({[k]:next})});S.settings={...S.settings,...(S.serverSettings?.preferences||{})};notify('设置已保存');}catch(err){S.settings[k]=before;notify('设置保存失败，请稍后重试');}render();});
  const sexport=document.getElementById('settings-export'); if(sexport) sexport.onclick=()=>notify('个人数据导出入口已就绪，接入后端后将生成 JSON 备份');
  const simport=document.getElementById('settings-import'); const sif=document.getElementById('settings-import-file');
  if(simport&&sif){simport.onclick=()=>sif.click();sif.onchange=()=>{const f=sif.files?.[0];if(!f)return;notify(`已选择备份文件：${f.name}`);};}

  document.querySelectorAll('[data-resume-tab]').forEach(el=>el.onclick=()=>{S.resume.tab=el.dataset.resumeTab;render();});
  document.querySelectorAll('[data-resume-select]').forEach(el=>el.onclick=async()=>{const id=el.dataset.resumeSelect;if(!id)return;try{await apiRequest(`/resumes/${encodeURIComponent(id)}/activate`,{method:'POST'});await Promise.all([refreshResumes(),refreshServerSettings()]);S.resume.saved=true;render();notify('已切换当前简历');}catch(err){notify('切换简历失败');}});
  const rnew=document.getElementById('resume-new'); const rnew2=document.getElementById('resume-new-2');
  const startResumeDraft=async()=>{try{const created=await apiRequest('/resumes',{method:'POST',body:JSON.stringify({name:'未命名简历',source_type:'structured',raw_text:''})});await refreshResumes();S.activeResume=created;S.resume.tab='structured';S.resume.saved=false;render();notify('已创建空白简历');}catch(err){notify('新建简历失败');}};
  if(rnew) rnew.onclick=startResumeDraft; if(rnew2) rnew2.onclick=startResumeDraft;
  const rr=document.getElementById('resume-replace'); if(rr) rr.onclick=()=>{S.resume.tab='pdf';render();};
  const uploadResumeFile=async f=>{if(!f)return;const form=new FormData();form.append('file',f);try{notify('正在解析简历…');await apiRequest('/resumes/import',{method:'POST',body:form});await Promise.all([refreshResumes(),refreshServerSettings()]);S.resume.saved=true;S.resume.tab='structured';render();notify(`已导入并解析：${f.name}`);}catch(err){console.error(err);notify('简历导入失败，请检查文件格式');}};
  const rpf=document.getElementById('resume-pick-file'); const rfi=document.getElementById('resume-file-input');
  if(rpf&&rfi){rpf.onclick=()=>rfi.click();rfi.onchange=()=>uploadResumeFile(rfi.files?.[0]);}
  const ruz=document.querySelector('.resume-upload-area'); if(ruz){ruz.ondragover=e=>{e.preventDefault();ruz.classList.add('dragging');};ruz.ondragleave=()=>ruz.classList.remove('dragging');ruz.ondrop=e=>{e.preventDefault();ruz.classList.remove('dragging');uploadResumeFile(e.dataTransfer?.files?.[0]);};}
  const rsave=document.getElementById('resume-save'); if(rsave) rsave.onclick=async()=>{const ar=S.activeResume;if(!ar){notify('请先新建或导入一份简历');return;}let text=(document.getElementById('resume-text')?.value||'').trim();if(S.resume.tab==='structured'){const name=(document.getElementById('resume-name')?.value||ar.structured_json?.name||'').trim();const target=(document.getElementById('resume-target')?.value||ar.structured_json?.target_role||'').trim();const education=(document.getElementById('resume-education')?.value||ar.structured_json?.education||'').trim();const skills=(ar.structured_json?.skills||[]).join('、');text=`${name}${target?'｜'+target:''}\n${target?'目标：'+target+'\n':''}${education?'学历：'+education+'\n':''}项目：${ar.structured_json?.projects?.[0]?.name||'主要项目'}\n职责：${text}\n${skills?'技能：'+skills:''}`.trim();}if(!text){document.getElementById('resume-text')?.focus();notify('请先填写简历内容');return;}try{await apiRequest(`/resumes/${encodeURIComponent(ar.id)}`,{method:'PATCH',body:JSON.stringify({raw_text:text,source_type:S.resume.tab==='structured'?'structured':'text'})});await apiRequest(`/resumes/${encodeURIComponent(ar.id)}/parse`,{method:'POST'});await Promise.all([refreshResumes(),refreshServerSettings()]);S.resume.saved=true;render();notify('简历已保存并重新解析');}catch(err){console.error(err);notify('简历保存失败');}};

  const rpick=document.getElementById('record-pick-file'); const rfile=document.getElementById('record-file-input');
  const setRecordingFile=f=>{if(!f)return;S.recording.file=f;S.recording.fileName=f.name;S.recording.recordId=null;S.recording.text='';S.recording.segments=[];S.recording.transcriptionMeta=null;S.recording.transcribed=false;S.recording.transcribing=false;S.recording.analysis=null;S.recording.analyzed=false;S.recordingAnalyzed=false;render();setTimeout(()=>notify(`录音文件已选择：${f.name}`),0);};
  if(rpick&&rfile){rpick.onclick=()=>rfile.click();rfile.onchange=()=>setRecordingFile(rfile.files?.[0]);}
  const ruz2=document.querySelector('.record-upload-zone'); if(ruz2){ruz2.ondragover=e=>{e.preventDefault();ruz2.classList.add('dragging');};ruz2.ondragleave=()=>ruz2.classList.remove('dragging');ruz2.ondrop=e=>{e.preventDefault();ruz2.classList.remove('dragging');setRecordingFile(e.dataTransfer?.files?.[0]);};}

  const ki=document.getElementById('knowledge-import'); const kfi=document.getElementById('knowledge-file-input');
  if(ki&&kfi){ki.onclick=()=>kfi.click();kfi.onchange=async()=>{const f=kfi.files?.[0];if(!f)return;try{const fd=new FormData();fd.append('file',f);fd.append('category',S.knowledge.category==='全部'?'核心知识':S.knowledge.category);await apiRequest('/knowledge/import',{method:'POST',body:fd});await refreshKnowledge();S.knowledge.imported=true;S.knowledge.selected=0;render();setTimeout(()=>notify(`资料已导入并建立索引：${f.name}`),0);}catch(err){console.warn('knowledge import api unavailable',err);notify('资料导入失败，请检查文件格式');}};}
  const knew=document.getElementById('knowledge-new'); if(knew) knew.onclick=()=>{S.knowledge.editorId='new';render();setTimeout(()=>document.getElementById('kb-edit-title')?.focus(),0);};
  document.querySelectorAll('[data-knowledge-category]').forEach(el=>el.onclick=()=>{S.knowledge.category=el.dataset.knowledgeCategory;S.knowledge.selected=null;render();});
  document.querySelectorAll('[data-knowledge-view]').forEach(el=>{el.onclick=()=>{S.knowledge.selected=Number(el.dataset.knowledgeView);render();};el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();S.knowledge.selected=Number(el.dataset.knowledgeView);render();}};});
  const kc=document.getElementById('knowledge-close'); if(kc) kc.onclick=()=>{S.knowledge.selected=null;render();};
  const ks=document.getElementById('knowledge-search'); if(ks) ks.oninput=e=>{S.knowledge.query=e.target.value;clearTimeout(knowledgeSearchTimer);const q=e.target.value.trim();if(!q){knowledgeSearchSeq++;S.knowledge.searchResults=[];S.knowledge.searchEngine='';S.knowledge.searching=false;render();return;}S.knowledge.searching=true;render();knowledgeSearchTimer=setTimeout(()=>runKnowledgeSearch(q),280);};
  document.querySelectorAll('[data-knowledge-source]').forEach(el=>el.onclick=()=>{const id=el.dataset.knowledgeSource;const idx=knowledgeDocs().findIndex(d=>d.id===id);if(idx>=0){S.knowledge.selected=idx;render();}});
  const kedit=document.getElementById('knowledge-edit'); if(kedit) kedit.onclick=()=>{S.knowledge.editorId=kedit.dataset.knowledgeEdit;render();};
  const closeKnowledgeEditor=()=>{S.knowledge.editorId=null;render();};
  ['knowledge-editor-close','knowledge-editor-cancel'].forEach(id=>{const el=document.getElementById(id);if(el)el.onclick=closeKnowledgeEditor;});
  const keb=document.getElementById('knowledge-editor-backdrop'); if(keb) keb.onclick=e=>{if(e.target===keb)closeKnowledgeEditor();};
  const kformat=document.getElementById('kb-editor-format'); if(kformat) kformat.onclick=()=>{const s1=document.getElementById('kb-edit-snippet-1');const s2=document.getElementById('kb-edit-snippet-2');const desc=document.getElementById('kb-edit-desc');if(s1&&!s1.value.trim()&&desc?.value.trim())s1.value=desc.value.trim();if(s2&&!s2.value.trim())s2.value='面试使用建议：回答时说明适用场景、方案取舍、边界条件和验证方式。';notify('已整理为更适合面试引用的结构');};
  const ksave=document.getElementById('knowledge-editor-save'); if(ksave) ksave.onclick=async()=>{
    const title=(document.getElementById('kb-edit-title')?.value||'').trim();
    const type=document.getElementById('kb-edit-type')?.value||'核心知识';
    const meta=(document.getElementById('kb-edit-meta')?.value||'').trim();
    const desc=(document.getElementById('kb-edit-desc')?.value||'').trim();
    const snippets=[(document.getElementById('kb-edit-snippet-1')?.value||'').trim(),(document.getElementById('kb-edit-snippet-2')?.value||'').trim()].filter(Boolean);
    if(!title){document.getElementById('kb-edit-title')?.focus();notify('请填写知识点标题');return;}
    if(!snippets.length){document.getElementById('kb-edit-snippet-1')?.focus();notify('至少填写一个正文片段');return;}
    const existing=S.knowledge.editorId==='new'?null:knowledgeDocs().find(d=>d.id===S.knowledge.editorId);
    const raw_text=snippets.join('\n\n');
    const payload={title,raw_text,category:type,meta:meta||'手动知识点',desc:desc||snippets[0].slice(0,80),used:existing?.used||'专项训练 / 面试准备 / 成长 Agent'};
    try{
      const saved=existing?await apiRequest(`/knowledge/${encodeURIComponent(existing.id)}`,{method:'PATCH',body:JSON.stringify(payload)}):await apiRequest('/knowledge',{method:'POST',body:JSON.stringify(payload)});
      await refreshKnowledge();
      const fresh=knowledgeDocs();S.knowledge.selected=fresh.findIndex(d=>d.id===saved.id);S.knowledge.category='全部';S.knowledge.query='';S.knowledge.editorId=null;render();setTimeout(()=>notify(existing?'知识点修改已保存到知识库':'知识点已创建并建立可检索索引'),0);
    }catch(err){
      console.warn('knowledge save api unavailable',err);
      notify('知识库后端暂不可用，本次修改未保存');
    }
  };

  document.querySelectorAll('[data-history-filter]').forEach(el=>el.onclick=()=>{S.historyFilter=el.dataset.historyFilter;render();});
  document.querySelectorAll('[data-history-open]').forEach(el=>el.onclick=async()=>{const id=el.dataset.historyId;const record=(S.historyData?.items||[]).find(x=>x.id===id);await openHistoryRecord(record);render();});

  const cp=document.getElementById('copilot-start'); if(cp) cp.onclick=()=>{if(S.copilotStarted){resetInterview();S.interview.mode='training';S.interview.started=true;S.trainingAssist='hint';S.view='interview';render();}else{S.copilotStarted=true;render();setTimeout(()=>notify('训练辅助已就绪'),0);}};
  document.querySelectorAll('[data-assist]').forEach(el=>el.onclick=()=>{S.trainingAssist=el.dataset.assist;render();});

  const askAgent=async text=>{
    const q=(text||'').trim(); if(!q||S.agent.loading)return;
    S.agent.loading=true;
    S.agent.messages.push({role:'user',text:q,time:'刚刚'});
    render();
    try{
      if(!S.agent.conversationId){
        const created=await apiRequest('/agent/conversations',{method:'POST',body:JSON.stringify({title:'新对话'})});
        S.agent.conversationId=created.id;
      }
      const result=await apiRequest(`/agent/conversations/${encodeURIComponent(S.agent.conversationId)}/messages`,{method:'POST',body:JSON.stringify({role_id:S.roleId,text:q})});
      applyAgentConversation(result.conversation);
      await refreshAgentConversations();
    }catch(err){
      console.warn('growth agent api unavailable',err);
      const response=agentResponse(q);
      S.agent.activeConversation=q.length>28?q.slice(0,28)+'…':q;
      S.agent.messages=[...S.agent.messages.filter((m,i,a)=>!(m.role==='user'&&i<a.length-1&&m.text===q)),{role:'assistant',text:response.reply,time:'本地兜底'}];
      S.agent.planTitle=response.title;
      S.agent.plan=response.plan.map(x=>({...x,status:''}));
      notify('成长 Agent 后端暂不可用，已使用本地建议');
    }finally{
      S.agent.loading=false;render();
      setTimeout(()=>{const body=document.getElementById('agent-chat-body');if(body)body.scrollTop=body.scrollHeight;},0);
    }
  };
  document.querySelectorAll('[data-agent-prompt]').forEach(el=>el.onclick=()=>askAgent(el.dataset.agentPrompt));
  const agentSend=document.getElementById('agent-send'); const agentInput=document.getElementById('agent-input');
  if(agentSend&&agentInput){agentSend.onclick=()=>askAgent(agentInput.value);agentInput.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();askAgent(agentInput.value);}};}
  const agentNew=document.getElementById('agent-new'); if(agentNew) agentNew.onclick=()=>{S.agent.conversationId=null;S.agent.messages=[];S.agent.plan=[];S.agent.planTitle='';S.agent.activeConversation='新对话';S.agent.loading=false;render();};
  document.querySelectorAll('[data-agent-conversation]').forEach(el=>el.onclick=async()=>{try{const conv=await apiRequest(`/agent/conversations/${encodeURIComponent(el.dataset.agentConversation)}`);applyAgentConversation(conv);render();}catch(err){console.warn('agent conversation load failed',err);notify('对话加载失败');}});
  const openAgentStep=async(view,index)=>{
    const step=Number.isFinite(index)?S.agent.plan[index]:null;
    if(step){step.status='done';if(S.agent.conversationId&&step.id){apiRequest(`/agent/conversations/${encodeURIComponent(S.agent.conversationId)}/plan`,{method:'PATCH',body:JSON.stringify({action_id:step.id,status:'done'})}).catch(err=>console.warn('agent plan sync failed',err));}}
    if(view==='drill'){
      const topic=step?.payload?.competency_id?competencyToTopic(step.payload.competency_id):'middleware';
      persistTrainingDomain(topic);S.drill.source=`成长 Agent：${step?.title||'当前能力缺口'}`;S.drill.started=false;S.drill.submitted=false;
    }
    if(view==='interview'){resetInterview();S.interview.mode='evaluation';}
    if(view==='report')S.auditIndex=0;
    if(view==='history')await refreshHistory();
    S.view=view;render();
  };
  document.querySelectorAll('[data-agent-action]').forEach(el=>el.onclick=()=>openAgentStep(el.dataset.agentAction,Number(el.dataset.agentStep)));
  const agentContinue=document.getElementById('agent-continue'); if(agentContinue) agentContinue.onclick=()=>{const i=S.agent.plan.findIndex(x=>x.status!=='done');const step=S.agent.plan[i];if(step)openAgentStep(step.view,i);else notify('当前计划已全部完成');};

  const pt=document.getElementById('profile-train'); if(pt) pt.onclick=()=>{const focus=S.profile.data?.focus;const topic=competencyToTopic(focus?.competency_id||'reliability');persistTrainingDomain(topic);S.drill.source=`我的画像：${focus?.name||'当前焦点能力'} · ${focus?.latest_assessment_status==='unknown'?'待验证':'证据补强'}`;S.drill.started=false;S.view='drill';render();};
  document.querySelectorAll('[data-profile-filter]').forEach(el=>el.onclick=()=>{S.profile.evidenceFilter=el.dataset.profileFilter;S.profile.evidenceExpanded=false;render();});
  const pem=document.getElementById('profile-evidence-more'); if(pem) pem.onclick=()=>{S.profile.evidenceExpanded=!S.profile.evidenceExpanded;render();};
  document.querySelectorAll('[data-profile-session]').forEach(el=>el.onclick=async()=>{const sid=el.dataset.profileSession;if(!sid){const loaded=await loadLatestAssessmentReport();if(!loaded)notify('当前还没有可回溯的评估来源');render();return;}if(sid.startsWith('sess-')){await loadAssessmentContext(sid,{openView:'report'});}else{await refreshHistory();const rec=(S.historyData?.items||[]).find(x=>x.id===sid);if(rec)await openHistoryRecord(rec);else notify('这条画像事件的来源记录暂不可用');}render();});
  document.querySelectorAll('[data-profile-report]').forEach(el=>el.onclick=async()=>{const loaded=await loadLatestAssessmentReport();if(!loaded)notify('当前还没有可回溯的评估报告');render();});

  const darkToggle=document.getElementById('dark-toggle');
  if(darkToggle) darkToggle.onclick=()=>{
    S.ui.dark=!S.ui.dark;
    localStorage.setItem('zhidao-dark',S.ui.dark?'1':'0');
    render();
  };
  const collapseSidebar=document.getElementById('collapse-sidebar');
  if(collapseSidebar) collapseSidebar.onclick=()=>{
    S.ui.collapsed=!S.ui.collapsed;
    localStorage.setItem('zhidao-sidebar-collapsed',S.ui.collapsed?'1':'0');
    render();
  };
}
function setAuthMsg(msg, type='error'){
  S.auth.message=msg; S.auth.messageType=type;
  render();
}
function accountKind(v){
  if(/^1[3-9]\d{9}$/.test(v)) return 'phone';
  if(/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v)) return 'email';
  return null;
}
function pwdStrength(p){
  if(!p) return 0;
  // 长度是硬门槛：不足 8 位，字符再复杂也判「弱」
  if(p.length<8) return 1;
  let s=0;
  if(p.length>=8) s++;
  if(p.length>=12) s++;
  const kinds=[/[a-z]/.test(p),/[A-Z]/.test(p),/\d/.test(p),/[^A-Za-z0-9]/.test(p)].filter(Boolean).length;
  if(kinds>=2) s++;
  if(kinds>=3) s++;
  return Math.min(3, s);
}
function bindAuth(){
  document.querySelectorAll('[data-auth-mode]').forEach(el=>el.onclick=()=>{S.auth.mode=el.dataset.authMode;S.auth.message='';S.auth.strength=0;S.auth.showPwd=false;S.auth.showConfirm=false;render();});
  const toggle=document.getElementById('toggle-password'); if(toggle) toggle.onclick=()=>{S.auth.showPwd=!S.auth.showPwd;render();};
  const toggleConf=document.getElementById('toggle-confirm'); if(toggleConf) toggleConf.onclick=()=>{S.auth.showConfirm=!S.auth.showConfirm;render();};
  const forgot=document.getElementById('forgot-password'); if(forgot) forgot.onclick=()=>{setAuthMsg('当前为演示版本，密码重置暂未接入，如需重置请联系管理员。');};
  const pwdInput=document.getElementById('auth-password'); if(pwdInput) pwdInput.oninput=()=>{S.auth.strength=pwdStrength(pwdInput.value);const str=document.querySelector('.pwd-strength-text');const bar=document.querySelector('.pwd-strength-bar');const bars=document.querySelectorAll('.pwd-strength-bar i');if(str){const m=[['',''],['弱','#ef4444'],['中','#f59e0b'],['强','#10b981']][S.auth.strength];str.textContent=m[0];str.style.color=m[1];}if(bar)bar.className='pwd-strength-bar '+(S.auth.strength>0?'lv'+S.auth.strength:'');bars.forEach((b,i)=>b.className=S.auth.strength>=i+1?'on':'');};
  const form=document.getElementById('auth-form'); if(form) form.onsubmit=async e=>{
    e.preventDefault();
    if(S.auth.submitting) return;
    const isRegister=S.auth.mode==='register';
    const account=(document.getElementById('auth-account')?.value||'').trim();
    const password=(document.getElementById('auth-password')?.value||'').trim();
    // 账号校验
    if(!account){markField('auth-account',true);setAuthMsg('请输入手机号或邮箱');return;}
    const kind=accountKind(account);
    if(!kind){markField('auth-account',true);setAuthMsg('账号格式不正确，请输入有效的手机号或邮箱');return;}
    markField('auth-account',false);
    // 密码校验
    if(password.length<6){markField('auth-password',true);setAuthMsg('密码至少需要 6 位');return;}
    if(isRegister && password.length<8){markField('auth-password',true);setAuthMsg('注册密码至少需要 8 位');return;}
    markField('auth-password',false);
    let name='';
    if(isRegister){
      name=(document.getElementById('auth-name')?.value||'').trim();
      const confirm=(document.getElementById('auth-confirm')?.value||'').trim();
      if(!name){markField('auth-name',true);setAuthMsg('请输入姓名');return;}
      markField('auth-name',false);
      if(password!==confirm){markField('auth-confirm',true);setAuthMsg('两次输入的密码不一致');return;}
      markField('auth-confirm',false);
      if(!document.getElementById('auth-agree')?.checked){setAuthMsg('请先同意服务条款与隐私说明');return;}
    }
    // 记住账号
    if(document.getElementById('auth-remember')?.checked){localStorage.setItem('zhidao-remember-account',account);localStorage.setItem('zhidao-remember-on','1');}
    else {localStorage.removeItem('zhidao-remember-account');localStorage.removeItem('zhidao-remember-on');}
    // 真实认证请求
    S.auth.submitting=true; S.auth.message=''; render();
    try{
      const data=await apiRequest(isRegister?'/auth/register':'/auth/login',{method:'POST',body:JSON.stringify({account,password,name})});
      localStorage.setItem('zhidao-token',data.token);
      localStorage.setItem('zhidao-auth','1');
      localStorage.setItem('zhidao-auth-account',account);
      if(data.user?.name) localStorage.setItem('zhidao-user-name',data.user.name);
      S.auth.loggedIn=true; S.auth.submitting=false; S.auth.message=''; S.view='home';
      render();
    }catch(err){
      S.auth.submitting=false;
      S.auth.message=err?.message||'请求失败，请稍后重试';
      S.auth.messageType='error';
      render();
    }
  };
}
function markField(id, error){
  const el=document.getElementById(id);
  if(!el) return;
  const wrap=el.closest('.field-wrap')||el;
  if(error){wrap.classList.add('field-error');} else {wrap.classList.remove('field-error');}
}
function bindMotion(){
  const hero=document.querySelector('.home-hero');
  if(hero) hero.onpointermove=e=>{const r=hero.getBoundingClientRect();hero.style.setProperty('--mx',`${((e.clientX-r.left)/r.width)*100}%`);hero.style.setProperty('--my',`${((e.clientY-r.top)/r.height)*100}%`);};
}
function render(){
  if(!S.auth.loggedIn){root.innerHTML=authView();bindAuth();return;}
  root.innerHTML=shell(`<div class="view-enter">${renderView()}</div>`); bind(); bindMotion();
  const out=document.getElementById('logout-btn'); if(out) out.onclick=async()=>{
    try{await apiRequest('/auth/logout',{method:'POST'});}catch(e){}
    ['zhidao-token','zhidao-auth','zhidao-auth-account'].forEach(k=>localStorage.removeItem(k));
    S.auth.loggedIn=false;S.auth.mode='login';S.auth.message='';S.view='home';render();
  };
}

async function bootstrap(){
  // 先用 token 校验会话，失效则回到登录页
  if(localStorage.getItem('zhidao-token')){
    try{
      const me=await apiRequest('/auth/me');
      if(me?.name) localStorage.setItem('zhidao-user-name',me.name);
      S.auth.loggedIn=true;
    }catch(err){
      ['zhidao-token','zhidao-auth','zhidao-auth-account'].forEach(k=>localStorage.removeItem(k));
      S.auth.loggedIn=false;
    }
  }
  if(!S.auth.loggedIn){ render(); return; }
  try{
    S.roles=await apiRequest('/roles');
    S.backendReady=true;
  }catch(err){
    console.warn('roles api unavailable, fallback to static template',err);
    try{S.roles=await fetch('templates/roles.json').then(r=>r.json());}catch(e){root.innerHTML=`<div class="fatal">岗位模板加载失败：${esc(e.message)}。</div>`;return;}
  }
  if(!S.roles.some(r=>r.id===S.roleId))S.roleId=S.roles[0]?.id;
  await Promise.all([refreshDashboard(),refreshServerSettings(),refreshResumes(),refreshKnowledge(),refreshProfile(),refreshQuestionGraph(),refreshHistory(),refreshAgentConversations(),refreshJobs()]);
  render();
}
bootstrap();
