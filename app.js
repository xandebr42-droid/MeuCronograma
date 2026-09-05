const LEGACY_STORAGE_KEY="faresi_academico_local_v13_conclusao_celulas";const USER_STORAGE_BASE="meu_cronograma_v20_user";
const CURRENT_DATE="2026-08-21";
const FULL_PSICO_ITEMS=[];
const demo={profile:{full_name:"Aluno",institution:"FARESI",course:"Psicologia",semester:"3º semestre",academic_period:"2026.2"},subjects:[],items:[],files:[]};
let supabaseClient=null,currentUser=null,cloudReady=false,cloudSaveTimer=null;
let authFlowLock=null,pendingAuthUser=null,pendingAuthEmail="";
let data=structuredClone(demo),view="hoje",selectedSubject=null,ui={filter:"all",subject:"all",search:""},cursor=new Date(2026,7,1),pendingConfirm=null,lastImportedSubjectId=null;
const $=id=>document.getElementById(id);const uid=(p="id")=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,6);const subject=id=>data.subjects.find(s=>s.id===id);const typeColor=t=>({aula:"#2D7FF9",atividade:"#E9982D",prova:"#D9485F",seminario:"#9B59B6",evento:"#7D8798",tarefa:"#188A67"})[t]||"#6557DF";const fmt=d=>new Intl.DateTimeFormat("pt-BR",{day:"2-digit",month:"short"}).format(new Date(d+"T12:00:00"));

function migrate(d){
  d.profile=d.profile||structuredClone(demo.profile);
  d.subjects=Array.isArray(d.subjects)?d.subjects:[];
  d.items=Array.isArray(d.items)?d.items:[];
  d.items.forEach(item=>{
    if(typeof item.completed!=="boolean")item.completed=false;
    if(!Array.isArray(item.calendar_dates))item.calendar_dates=item.event_date?[item.event_date]:[];
    // Recupera datas antigas caso alguma versão tenha salvo DD/MM ou DD/MM/AAAA.
    if(item.event_date&&!/^\d{4}-\d{2}-\d{2}$/.test(String(item.event_date))){
      const fixed=parseDate(item.event_date,getAcademicYear());
      if(fixed)item.event_date=fixed;
    }
  });
  d.files=Array.isArray(d.files)?d.files:[];
  d.preferences=d.preferences||{theme:"light"};
  if(!["system","light","dark"].includes(d.preferences.theme))d.preferences.theme="system";
  
  const ps=d.subjects.find(s=>s.id==="psico"||/Psicologia do Desenvolvimento II/i.test(s.name||""));
  if(ps){
    FULL_PSICO_ITEMS.forEach(seed=>{
      let old=d.items.find(x=>x.subject_id===ps.id&&x.event_date===seed.event_date);
      if(!old)d.items.push({...seed,id:uid("m"),subject_id:ps.id,completed:false});
      else if(!old.manually_edited){
        old.lesson_number=old.lesson_number||seed.lesson_number;
        old.teaching_strategy=old.teaching_strategy||seed.teaching_strategy;
        old.assessment=old.assessment||seed.assessment;
        old.bibliography=old.bibliography||seed.bibliography;
        old.points=old.points??seed.points;
      }
    })
  }
  return d
}
function userStorageKey(userId=currentUser?.id){
  return userId?`${USER_STORAGE_BASE}:${userId}`:USER_STORAGE_BASE;
}
function localStateForUser(userId=currentUser?.id){
  if(!userId)return structuredClone(demo);
  try{
    const raw=localStorage.getItem(userStorageKey(userId));
    return raw?migrate(JSON.parse(raw)):structuredClone(demo);
  }catch(e){
    return structuredClone(demo);
  }
}
function cacheCurrentState(){
  if(!currentUser)return;
  localStorage.setItem(userStorageKey(),JSON.stringify(data));
}
async function readCloudState(){
  if(!supabaseClient||!currentUser)return null;
  const {data:row,error}=await supabaseClient
    .from("user_app_state")
    .select("state")
    .eq("user_id",currentUser.id)
    .maybeSingle();
  if(error)throw error;
  return row?.state?migrate(row.state):null;
}
async function writeCloudState(){
  if(!supabaseClient||!currentUser||!cloudReady)return;
  const {error}=await supabaseClient
    .from("user_app_state")
    .upsert({user_id:currentUser.id,state:data},{onConflict:"user_id"});
  if(error)throw error;
}
function save(){
  cacheCurrentState();
  if(!cloudReady||!currentUser)return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer=setTimeout(()=>{
    writeCloudState().catch(err=>{
      console.error("Falha de sincronização:",err);
    });
  },350);
}function toast(msg){$("toast").textContent=msg;$("toast").classList.remove("hidden");setTimeout(()=>$("toast").classList.add("hidden"),2400)}function openModal(id){$("modalBackdrop").classList.remove("hidden");$(id).classList.remove("hidden")}function closeModals(){$("modalBackdrop").classList.add("hidden");document.querySelectorAll(".modal").forEach(m=>m.classList.add("hidden"));pendingConfirm=null}
function confirmAction(title,message,fn,label="Sim, apagar"){pendingConfirm=fn;$("confirmTitle").textContent=title;$("confirmMessage").textContent=message;$("confirmAction").textContent=label;openModal("confirmModal")}
function itemSubjectName(x){return subject(x.subject_id)?.name||"Disciplina"}
function localIso(date){
  const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,"0"),d=String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}
function dateFromIso(iso){
  const m=String(iso||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m)return null;
  const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),12,0,0,0);
  return Number.isNaN(d.getTime())?null:d;
}
function validAgendaItems(){
  return data.items.filter(x=>dateFromIso(x.event_date));
}
function lessonSortValue(v){
  const m=String(v||"").match(/\d+/);
  return m?Number(m[0]):999999;
}
function sortAgenda(items){
  return [...items].sort((a,b)=>{
    const byDate=String(a.event_date).localeCompare(String(b.event_date));
    if(byDate)return byDate;
    const sa=itemSubjectName(a).localeCompare(itemSubjectName(b),"pt-BR");
    if(sa)return sa;
    return lessonSortValue(a.lesson_number)-lessonSortValue(b.lesson_number);
  });
}
function currentDateIso(){
  // CURRENT_DATE é fixado pela versão para que o cronograma acadêmico seja
  // reproduzível no teste. Todas as telas usam exatamente a mesma referência.
  return CURRENT_DATE;
}
function weekBounds(iso=currentDateIso()){
  const base=dateFromIso(iso)||new Date();
  const day=base.getDay(); // 0 domingo
  const diffToMonday=day===0?-6:1-day;
  const start=new Date(base);start.setDate(base.getDate()+diffToMonday);
  const end=new Date(start);end.setDate(start.getDate()+6);
  return {start:localIso(start),end:localIso(end),startDate:start,endDate:end};
}
function monthBounds(iso=currentDateIso()){
  const base=dateFromIso(iso)||new Date();
  const start=new Date(base.getFullYear(),base.getMonth(),1,12);
  const end=new Date(base.getFullYear(),base.getMonth()+1,0,12);
  return {start:localIso(start),end:localIso(end),year:base.getFullYear(),month:base.getMonth()};
}
function itemsBetween(start,end){
  return sortAgenda(validAgendaItems().filter(x=>x.event_date>=start&&x.event_date<=end));
}
function agendaEmpty(title,text){
  return `<div class="card empty-state agenda-empty"><b>${escapeHtml(title)}</b><p>${escapeHtml(text)}</p></div>`;
}


function applyTheme(){
  const pref=data.preferences?.theme||"light";
  const systemDark=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark=pref==="dark"||(pref==="system"&&systemDark);
  document.documentElement.dataset.theme=dark?"dark":"light";
}
function setTheme(pref){
  data.preferences=data.preferences||{};
  data.preferences.theme=pref;
  save();
  applyTheme();
  render();
}
function themeControl(){
  const pref=data.preferences?.theme||"system";
  return `<div class="theme-switcher" aria-label="Tema">
    <button class="${pref==="light"?"active":""}" data-theme="light" title="Modo claro">☀</button>
    <button class="${pref==="system"?"active":""}" data-theme="system" title="Seguir sistema">◐</button>
    <button class="${pref==="dark"?"active":""}" data-theme="dark" title="Modo escuro">☾</button>
  </div>`;
}
function normalizedText(v){
  return String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
}
function itemMatchesSearch(x,query){
  const q=normalizedText(query).trim();
  if(!q)return true;
  const s=subject(x.subject_id);
  const hay=[
    s?.name,s?.teacher,x.content,x.teaching_strategy,x.assessment,
    x.bibliography,x.lesson_number,x.type,x.source_type
  ].map(normalizedText).join(" ");
  return q.split(/\s+/).every(term=>hay.includes(term));
}
function filterAgendaItems(items){
  let result=[...items];
  if(ui.subject!=="all")result=result.filter(x=>x.subject_id===ui.subject);
  if(ui.filter==="pending")result=result.filter(x=>!x.completed);
  else if(ui.filter==="completed")result=result.filter(x=>x.completed);
  else if(ui.filter==="prova")result=result.filter(x=>x.type==="prova");
  else if(ui.filter==="atividade")result=result.filter(x=>x.type==="atividade");
  result=result.filter(x=>itemMatchesSearch(x,ui.search));
  return result;
}
function filterBar(){
  const options=[
    ["all","Todas"],
    ["pending","Pendentes"],
    ["completed","Concluídas"],
    ["prova","Provas"],
    ["atividade","Atividades"]
  ];
  return `<div class="agenda-tools">
    <div class="search-box">
      <span>⌕</span>
      <input id="globalSearch" value="${escapeAttr(ui.search)}" placeholder="Buscar disciplina, conteúdo, bibliografia..." autocomplete="off">
      ${ui.search?'<button class="clear-search" id="clearSearch" title="Limpar busca">×</button>':""}
    </div>
    <div class="filter-row">
      <div class="filter-chips">${options.map(([v,l])=>`<button class="filter-chip ${ui.filter===v?"active":""}" data-filter="${v}">${l}</button>`).join("")}</div>
      <select id="subjectFilter" class="subject-filter">
        <option value="all">Todas as disciplinas</option>
        ${data.subjects.map(s=>`<option value="${s.id}" ${ui.subject===s.id?"selected":""}>${escapeHtml(s.name)}</option>`).join("")}
      </select>
    </div>
  </div>`;
}
function progressData(items=validAgendaItems()){
  const total=items.length;
  const done=items.filter(x=>x.completed).length;
  const pct=total?Math.round((done/total)*100):0;
  return {total,done,pending:total-done,pct};
}
function progressPanel(){
  const p=progressData(validAgendaItems());
  const subjects=data.subjects.map(s=>{
    const items=validAgendaItems().filter(x=>x.subject_id===s.id);
    const done=items.filter(x=>x.completed).length;
    const pct=items.length?Math.round(done/items.length*100):0;
    return {s,total:items.length,done,pct};
  }).filter(x=>x.total>0).sort((a,b)=>b.pct-a.pct||a.s.name.localeCompare(b.s.name,"pt-BR"));
  return `<div class="progress-panel">
    <div class="progress-summary">
      <div>
        <span class="eyebrow">PROGRESSO DO SEMESTRE</span>
        <strong>${p.done} de ${p.total} células concluídas</strong>
        <small>${p.pending} pendente${p.pending!==1?"s":""}</small>
      </div>
      <div class="progress-ring" style="--progress:${p.pct}"><span>${p.pct}%</span></div>
    </div>
    <div class="progress-track"><span style="width:${p.pct}%"></span></div>
    ${subjects.length?`<div class="subject-progress-list">${subjects.slice(0,5).map(({s,total,done,pct})=>`
      <div class="subject-progress-row">
        <div class="subject-progress-label"><b>${escapeHtml(s.name)}</b><span>${done}/${total}</span></div>
        <div class="mini-progress"><span style="width:${pct}%;background:${s.color||"#6C5CE7"}"></span></div>
      </div>`).join("")}</div>`:""}
  </div>`;
}
function bindAgendaTools(){
  document.querySelectorAll("[data-filter]").forEach(b=>b.onclick=()=>{
    ui.filter=b.dataset.filter;render();
  });
  const sf=$("subjectFilter");
  if(sf)sf.onchange=()=>{ui.subject=sf.value;render()};
  const gs=$("globalSearch");
  if(gs){
    let timer;
    gs.oninput=()=>{
      clearTimeout(timer);
      timer=setTimeout(()=>{ui.search=gs.value;render()},180);
    };
    gs.onkeydown=e=>{if(e.key==="Escape"){ui.search="";render()}};
  }
  const cs=$("clearSearch");
  if(cs)cs.onclick=()=>{ui.search="";render()};
  document.querySelectorAll("[data-theme]").forEach(b=>b.onclick=()=>setTheme(b.dataset.theme));
}
function completionButton(x,compact=false){
  const done=!!x.completed;
  const label=done?(compact?"Concluída":"✓ Concluída"):(compact?"Concluir":"✓ Marcar como concluída");
  return `<button class="complete-toggle ${done?"is-complete":""}" type="button" data-toggle-complete="${x.id}" aria-pressed="${done}" title="${done?"Reabrir esta célula":"Marcar esta célula como concluída"}">${label}</button>`
}
function requestToggleComplete(id){
  const x=data.items.find(i=>i.id===id);if(!x)return;
  const name=itemSubjectName(x);
  if(x.completed){
    confirmAction(
      "Reabrir esta célula?",
      `A célula de “${name}” está marcada como concluída. Deseja retirar a conclusão e deixá-la novamente como pendente?`,
      ()=>{x.completed=false;save();render();toast("Célula marcada como pendente.");},
      "Sim, reabrir"
    );
  }else{
    confirmAction(
      "Confirmar conclusão?",
      `Você está prestes a marcar a célula de “${name}” (${fmt(x.event_date)}) como concluída. Confirme apenas se você realmente finalizou a atividade ou aula correspondente.`,
      ()=>{x.completed=true;save();render();toast("Célula concluída.");},
      "Sim, marcar como concluída"
    );
  }
}
function nav(){return [["hoje","Hoje"],["semana","Minha Semana"],["mes","Este Mês"],["semestre","Meu Semestre"],["calendario","Calendário"],["disciplinas","Disciplinas"],["arquivos","Arquivos"],["perfil","Perfil"]].map(([v,l])=>`<button data-view="${v}" class="${view===v?"active":""}">${l}</button>`).join("")}function mobile(){
  const items=[
    ["hoje","⌂","Hoje"],
    ["semana","▦","Semana"],
    ["calendario","□","Calendário"],
    ["disciplinas","≡","Disciplinas"],
    ["perfil","○","Perfil"]
  ];
  return items.map(([v,icon,label])=>`
    <button data-view="${v}" class="${view===v?"active":""}" aria-label="${label}">
      <span class="mobile-nav-icon">${icon}</span>
      <span>${label}</span>
    </button>`).join("")
}
function shell(content,title){
  const p=data.profile;
  return `<div class="shell">
    <aside class="sidebar">
      <div>
        <h2>Meu Cronograma</h2>
        <div class="sidebar-subtitle">${escapeHtml(p.institution||"FARESI")} • ${escapeHtml(p.academic_period||"")}</div>
      </div>
      <div class="nav">${nav()}</div>
      <div class="sidebar-bottom">
        ${progressData().total?`<div class="sidebar-progress"><span>Progresso</span><b>${progressData().pct}%</b><div><i style="width:${progressData().pct}%"></i></div></div>`:""}
        <button class="primary" data-import>＋ Importar arquivo</button>
        <button class="sidebar-user-button" data-account type="button">
          <span>${escapeHtml((currentAccountName().charAt(0)||"A").toUpperCase())}</span>
          <div><b>${escapeHtml(currentAccountName())}</b><small>${escapeHtml(currentUser?.email||"")}</small></div>
        </button>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div><span class="topbar-kicker">ORGANIZAÇÃO ACADÊMICA</span><h1>${title}</h1></div>
        <div class="actions desktop-actions">
          ${themeControl()}
          <button class="ghost" data-new-subject>＋ Disciplina</button>
          <button class="primary" data-import>＋ Importar</button>
          <button class="account-top-button" data-account type="button" title="Minha conta">${escapeHtml((currentAccountName().charAt(0)||"A").toUpperCase())}</button>
        </div>
        <div class="mobile-top-actions">
          <button class="mobile-action-btn" data-new-subject aria-label="Nova disciplina" title="Nova disciplina">＋</button>
          <button class="mobile-action-btn primary-mobile-action" data-import aria-label="Importar cronograma" title="Importar cronograma">⇧</button>
          <button class="mobile-action-btn account-top-button" data-account aria-label="Minha conta">${escapeHtml((currentAccountName().charAt(0)||"A").toUpperCase())}</button>
        </div>
      </header>
      ${content}
    </main>
    <div class="mobilebar">${mobile()}</div>
  </div>`
}function badge(x){return `<span class="badge" style="color:${typeColor(x.type)};background:${typeColor(x.type)}18">${x.type}${x.points?` • ${x.points} pts`:""}</span>`}function sum(n,l){return `<div class="card"><div class="summary-number">${n}</div><div class="summary-label">${l}</div></div>`}
function hoje(){
  const today=currentDateIso();
  const todayRaw=itemsBetween(today,today);
  const futureRaw=sortAgenda(validAgendaItems().filter(x=>x.event_date>today)).slice(0,12);
  const todayItems=filterAgendaItems(todayRaw);
  const upcoming=filterAgendaItems(futureRaw).slice(0,6);

  const renderHomeCell=x=>{
    const s=subject(x.subject_id);
    return `<div class="timeline-row home-cell ${x.completed?"completed-cell":""}" data-item="${x.id}" style="border-left:4px solid ${x.completed?"#24966b":(s?.color||typeColor(x.type))}">
      <div class="datebox"><b>${new Date(x.event_date+"T12:00:00").getDate()}</b><span>${fmt(x.event_date)}</span></div>
      <div class="grow">
        <div class="cell-topline">
          <div>
            <div class="cell-primary-title">${escapeHtml(s?.name||"Disciplina")}</div>
            <div class="cell-secondary-content">${escapeHtml(x.content||"Sem conteúdo")}</div>
          </div>
          ${badge(x)}
        </div>
        <div class="small cell-meta">${x.lesson_number?`Aula(s) ${escapeHtml(x.lesson_number)} • `:""}${x.bibliography?"Bibliografia disponível":"Sem bibliografia cadastrada"}${x.completed?" • Concluída":""}</div>
      </div>
      <div class="cell-side-actions">
        ${completionButton(x,true)}
        <button class="ghost" type="button" data-view-item="${x.id}">Ver detalhes</button>
      </div>
    </div>`;
  };

  const todayHtml=todayItems.length
    ?todayItems.map(renderHomeCell).join("")
    :agendaEmpty(ui.search||ui.filter!=="all"||ui.subject!=="all"?"Nenhum resultado para hoje":"Nenhuma célula para hoje",ui.search||ui.filter!=="all"||ui.subject!=="all"?"Tente remover algum filtro.":"As células continuam organizadas nas próximas datas do seu cronograma.");

  const upcomingHtml=upcoming.length
    ?upcoming.map(renderHomeCell).join("")
    :agendaEmpty(ui.search||ui.filter!=="all"||ui.subject!=="all"?"Nenhum próximo resultado":"Nenhuma próxima célula",ui.search||ui.filter!=="all"||ui.subject!=="all"?"Tente remover algum filtro.":"Não existem outras datas futuras cadastradas no momento.");

  const pendingToday=todayRaw.filter(x=>!x.completed).length;
  return shell(`
    <div class="hero">
      <span class="eyebrow" style="color:#fff">${new Intl.DateTimeFormat("pt-BR",{weekday:"long",day:"2-digit",month:"long"}).format(dateFromIso(today))}</span>
      <h2>${todayRaw.length?`${todayRaw.length} célula${todayRaw.length!==1?"s":""} para hoje`:"Seu dia está livre no cronograma."}</h2>
      <p>Veja suas demandas, pesquise qualquer conteúdo e acompanhe o progresso do semestre.</p>
      <div class="hero-actions"><button class="secondary" data-import>Importar cronograma</button></div>
    </div>

    <div class="section">${progressPanel()}</div>
    <div class="section">${filterBar()}</div>

    <div class="section">
      <div class="section-head"><div><h3>Hoje</h3><p>${pendingToday} pendente${pendingToday!==1?"s":""} • ${todayRaw.filter(x=>x.completed).length} concluída${todayRaw.filter(x=>x.completed).length!==1?"s":""}</p></div></div>
      <div class="timeline home-list">${todayHtml}</div>
    </div>

    <div class="section">
      <div class="section-head"><div><h3>Próximas células</h3><p>As próximas demandas, sem misturar com a agenda de hoje.</p></div></div>
      <div class="timeline home-list">${upcomingHtml}</div>
    </div>

    <div class="section">
      <div class="grid4">
        ${sum(todayRaw.length,"Hoje")}
        ${sum(todayRaw.filter(x=>x.type==="prova").length,"Provas hoje")}
        ${sum(todayRaw.filter(x=>x.type==="atividade").length,"Atividades hoje")}
        ${sum(todayRaw.filter(x=>x.completed).length,"Concluídas hoje")}
      </div>
    </div>
  `,"Hoje");
}
function row(x,showSubject=true){
  const edited=x.manually_edited?" • Editado por você":"";
  const s=subject(x.subject_id);
  const bib=x.bibliography?`<div class="bibliography-preview">${escapeHtml(x.bibliography)}</div>`:`<div class="bibliography-preview" style="opacity:.55">Bibliografia não informada</div>`;
  return `<div class="timeline-row ${x.completed?"completed-cell":""}" data-item="${x.id}">
    <div class="datebox"><b>${new Date(x.event_date+"T12:00:00").getDate()}</b><span>${fmt(x.event_date)}</span></div>
    <div class="grow">
      <div class="cell-topline">
        <div>
          <div class="cell-primary-title">${escapeHtml(s?.name||"Disciplina")}</div>
          <div class="cell-secondary-content">${escapeHtml(x.content||"Sem conteúdo")}</div>
        </div>
        ${badge(x)}
      </div>
      <div class="small cell-meta">${x.lesson_number?`Aula(s) ${escapeHtml(x.lesson_number)}`:"Sem número de aula"}${edited}${x.completed?" • Concluída":""}</div>
      ${bib}
    </div>
    <div class="row-actions cell-actions">
      ${completionButton(x,true)}
      <button class="icon-action" data-edit-item="${x.id}" title="Editar">✎</button>
      <button class="icon-action danger-icon" data-delete-item="${x.id}" title="Apagar">⌫</button>
    </div>
  </div>`
}
function semana(){
  const {start,end,startDate,endDate}=weekBounds();
  const raw=itemsBetween(start,end);
  const w=filterAgendaItems(raw);
  const titleRange=`${new Intl.DateTimeFormat("pt-BR",{day:"2-digit",month:"short"}).format(startDate)} – ${new Intl.DateTimeFormat("pt-BR",{day:"2-digit",month:"short"}).format(endDate)}`;
  const byDay=[];
  for(const x of w){
    let group=byDay.find(g=>g.date===x.event_date);
    if(!group){group={date:x.event_date,items:[]};byDay.push(group)}
    group.items.push(x);
  }
  const content=byDay.length?byDay.map(g=>`
    <div class="agenda-day-group">
      <div class="agenda-day-heading">
        <b>${new Intl.DateTimeFormat("pt-BR",{weekday:"long",day:"2-digit",month:"long"}).format(dateFromIso(g.date))}</b>
        <span>${g.items.length} célula${g.items.length!==1?"s":""}</span>
      </div>
      <div class="timeline">${g.items.map(x=>row(x,true)).join("")}</div>
    </div>`).join(""):agendaEmpty("Nenhuma célula encontrada",ui.search||ui.filter!=="all"||ui.subject!=="all"?"Tente remover algum filtro.":`Não há itens entre ${start} e ${end}.`);

  return shell(`
    <div class="section-head"><div><h3>${titleRange}</h3><p>Semana de segunda-feira a domingo.</p></div></div>
    ${filterBar()}
    <div class="grid4 top-gap">
      ${sum(raw.length,"Células")}
      ${sum(raw.filter(x=>x.type==="prova").length,"Provas")}
      ${sum(raw.filter(x=>x.type==="atividade").length,"Atividades")}
      ${sum(raw.filter(x=>x.completed).length,"Concluídas")}
    </div>
    <div class="section">${content}</div>
  `,"Minha Semana");
}
function mes(){
  const {start,end,year,month}=monthBounds();
  const raw=itemsBetween(start,end);
  const m=filterAgendaItems(raw);
  const byDate=[];
  for(const x of m){
    let group=byDate.find(g=>g.date===x.event_date);
    if(!group){group={date:x.event_date,items:[]};byDate.push(group)}
    group.items.push(x);
  }
  const content=byDate.length?byDate.map(g=>`
    <div class="agenda-day-group">
      <div class="agenda-day-heading">
        <b>${new Intl.DateTimeFormat("pt-BR",{weekday:"long",day:"2-digit",month:"long"}).format(dateFromIso(g.date))}</b>
        <span>${g.items.length} célula${g.items.length!==1?"s":""}</span>
      </div>
      <div class="timeline">${g.items.map(x=>row(x,true)).join("")}</div>
    </div>`).join(""):agendaEmpty("Nenhuma célula encontrada",ui.search||ui.filter!=="all"||ui.subject!=="all"?"Tente remover algum filtro.":"Não existem datas cadastradas para este mês.");

  return shell(`
    <div class="section-head"><div><h3 style="text-transform:capitalize">${new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric"}).format(new Date(year,month,1))}</h3><p>Todas as células do mês, agrupadas pelo dia correto.</p></div></div>
    ${filterBar()}
    <div class="grid4 top-gap">
      ${sum(raw.length,"Células")}
      ${sum(raw.filter(x=>x.type==="atividade").length,"Atividades")}
      ${sum(raw.filter(x=>x.type==="prova").length,"Provas")}
      ${sum(raw.filter(x=>x.completed).length,"Concluídas")}
    </div>
    <div class="section">${content}</div>
  `,"Este Mês");
}
function semestre(){const months=[["08","Agosto"],["09","Setembro"],["10","Outubro"],["11","Novembro"],["12","Dezembro"]];return shell(`<div class="grid4">${sum(data.subjects.length,"Disciplinas")}${sum(data.items.filter(x=>x.type==="atividade").length,"Atividades")}${sum(data.items.filter(x=>x.type==="prova").length,"Provas")}${sum(data.items.filter(x=>x.bibliography&&x.bibliography!=="—").length,"Bibliografias")}</div><div class="section timeline">${months.map(([m,n])=>{const a=data.items.filter(x=>x.event_date.slice(5,7)===m);return `<div class="card"><b>${n}</b><div class="small">${a.length} itens • ${a.filter(x=>x.type==="prova").length} provas • ${a.filter(x=>x.type==="atividade").length} atividades</div></div>`}).join("")}</div>`,"Meu Semestre")}
function calendario(){
  const y=cursor.getFullYear(),m=cursor.getMonth(),start=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate();
  let cells="";
  const mobileGroups=[];

  for(let i=0;i<42;i++){
    const n=i-start+1;
    if(n<1||n>days){
      cells+='<div class="calcell calcell-empty"></div>';
      continue;
    }

    const iso=`${y}-${String(m+1).padStart(2,"0")}-${String(n).padStart(2,"0")}`;
    const events=calendarItemsForDate(iso);

    if(events.length)mobileGroups.push({iso,events});

    const eventHtml=events.map(x=>{
      const s=subject(x.subject_id);
      const color=x.completed?"#24966b":(s?.color||typeColor(x.type));
      const title=`${s?.name||"Disciplina"} — ${x.content||"Sem conteúdo"}`;
      return `<button class="calendar-chip ${x.completed?"calendar-chip-complete":""}" type="button" data-item="${x.id}" style="--chip-color:${escapeAttr(color)}" title="${escapeAttr(title)}">
        <span class="calendar-chip-dot"></span>
        <span class="calendar-chip-name">${escapeHtml(s?.name||"Disciplina")}</span>
      </button>`;
    }).join("");

    cells+=`<div class="calcell ${events.length?"has-events":""}">
      <div class="calendar-day-number">${n}</div>
      <div class="calendar-day-events">${eventHtml}</div>
    </div>`;
  }

  const monthPrefix=`${y}-${String(m+1).padStart(2,"0")}-`;
  const monthItems=validAgendaItems().filter(item=>calendarDatesForItem(item).some(d=>d.startsWith(monthPrefix)));
  const placements=monthItems.reduce((total,item)=>total+calendarDatesForItem(item).filter(d=>d.startsWith(monthPrefix)).length,0);

  const mobileList=mobileGroups.length
    ?mobileGroups.map(group=>{
      const dt=dateFromIso(group.iso);
      return `<section class="mobile-calendar-day">
        <div class="mobile-calendar-date">
          <b>${String(dt.getDate()).padStart(2,"0")}</b>
          <span>${new Intl.DateTimeFormat("pt-BR",{weekday:"short",month:"short"}).format(dt)}</span>
        </div>
        <div class="mobile-calendar-events">
          ${group.events.map(x=>{
            const s=subject(x.subject_id);
            const color=x.completed?"#24966b":(s?.color||typeColor(x.type));
            return `<button class="mobile-calendar-card ${x.completed?"completed-cell":""}" type="button" data-item="${x.id}" style="--subject-color:${escapeAttr(color)}">
              <span class="mobile-calendar-color"></span>
              <span class="mobile-calendar-card-text">
                <b>${escapeHtml(s?.name||"Disciplina")}</b>
                <small>${escapeHtml(x.content||"Sem conteúdo")}</small>
              </span>
              <span class="mobile-calendar-chevron">›</span>
            </button>`;
          }).join("")}
        </div>
      </section>`;
    }).join("")
    :agendaEmpty("Nenhuma célula neste mês","As células aparecerão aqui assim que houver datas cadastradas.");

  return shell(`
    <div class="section-head calendar-toolbar">
      <button id="prev" class="ghost calendar-arrow" aria-label="Mês anterior">←</button>
      <div>
        <h3 style="text-transform:capitalize">${new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric"}).format(cursor)}</h3>
        <p>${monthItems.length} células • ${placements} marcações</p>
      </div>
      <button id="next" class="ghost calendar-arrow" aria-label="Próximo mês">→</button>
    </div>

    <div class="calendar-desktop-view">
      <div class="calendar calendar-compact">
        <div class="calendar-head">${["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].map(x=>`<div>${x}</div>`).join("")}</div>
        <div class="calendar-grid">${cells}</div>
      </div>
    </div>

    <div class="calendar-mobile-view">
      ${mobileList}
    </div>
  `,"Calendário");
}
function disciplinas(){return shell(`<div class="section-head"><div><h3>Minhas disciplinas</h3><p>Crie uma matéria ou importe o arquivo do professor diretamente.</p></div><button class="primary" data-new-subject>＋ Nova disciplina</button></div><div class="subject-list">${data.subjects.map(s=>{const its=data.items.filter(i=>i.subject_id===s.id),refs=its.filter(i=>i.bibliography&&i.bibliography!=="—").length;return `<div class="subject-row" data-subject="${s.id}" role="button" tabindex="0"><div class="subject-icon" style="background:${s.color||'#6557DF'}">${escapeHtml((s.name||'?')[0])}</div><div class="grow"><b>${escapeHtml(s.name)}</b><div class="small">${escapeHtml(s.teacher||"Professor não informado")} • ${its.length} itens • ${refs} com bibliografia</div></div><div class="row-actions"><button class="icon-action" data-edit-subject="${s.id}" title="Editar disciplina">✎</button><button class="icon-action" data-update-subject="${s.id}" title="Atualizar por arquivo">↻</button><button class="icon-action danger-icon" data-delete-subject="${s.id}" title="Apagar disciplina">⌫</button></div></div>`}).join("")||'<div class="card empty-state"><b>Nenhuma disciplina.</b><p>Adicione a primeira disciplina ou importe um cronograma.</p><button class="primary" data-new-subject>＋ Nova disciplina</button></div>'}</div>`,"Disciplinas")}
function disciplina(){const selectedSubjectId=typeof selectedSubject==="object"?selectedSubject?.id:selectedSubject;
  const s=subject(selectedSubjectId);
  if(!s){view="disciplinas";selectedSubject=null;return disciplinas();}if(!s||!data.subjects.some(x=>x.id===s.id)){view="disciplinas";return disciplinas()}const it=data.items.filter(x=>x.subject_id===s.id).sort((a,b)=>a.event_date.localeCompare(b.event_date));return shell(`<div class="hero" style="background:linear-gradient(120deg,#171820,${s.color||'#6557DF'})"><span class="eyebrow" style="color:#fff">DISCIPLINA</span><h2>${escapeHtml(s.name)}</h2><p>${escapeHtml(s.teacher||"Professor não informado")} • ${escapeHtml(s.workload||"Carga horária não informada")}</p><div class="hero-actions"><button class="secondary" data-update-subject="${s.id}">↻ Atualizar com arquivo</button><button class="ghost" data-edit-subject="${s.id}">✎ Editar disciplina</button><button class="ghost" data-add-item="${s.id}">＋ Adicionar célula</button></div></div><div class="section-head section"><div><h3>Cronograma</h3><p>Clique em uma célula para visualizar os detalhes. Para alterar algo, use o botão Editar.</p></div></div><div class="timeline">${it.map(x=>row(x,false)).join("")||'<div class="card empty-state"><b>Cronograma vazio.</b><p>Importe o arquivo desta disciplina ou adicione uma célula manualmente.</p></div>'}</div>`,"Disciplina")}
function arquivos(){return shell(`<div class="section-head"><div><h3>Arquivos importados</h3><p>Histórico local dos arquivos selecionados.</p></div><button class="primary" data-import>＋ Importar</button></div><div class="files">${data.files.map(f=>`<div class="file-row"><div class="grow"><b>${escapeHtml(f.name)}</b><div class="small">${escapeHtml(f.type||"Arquivo")} • ${escapeHtml(subject(f.subject_id)?.name||"Sem disciplina")}</div></div></div>`).join("")||'<div class="card empty-state"><b>Nenhum arquivo importado.</b></div>'}</div>`,"Arquivos")}
function perfil(){
  const p=data.profile,prog=progressData();
  return shell(`
    <div class="grid3">
      <div class="card profile-card">
        <span class="eyebrow">PERFIL</span>
        <h3>${escapeHtml(p.full_name)}</h3>
        <div class="small">${escapeHtml(p.course)} • ${escapeHtml(p.semester)}</div>
        <div class="small">${escapeHtml(p.institution)} • ${escapeHtml(p.academic_period)}</div>
        <button id="editProfile" class="secondary top-gap">Editar perfil</button>
      </div>
      <div class="card">
        <span class="eyebrow">APARÊNCIA</span>
        <h3>Tema do sistema</h3>
        <p class="small">Escolha claro, escuro ou deixe o sistema acompanhar seu dispositivo.</p>
        <div class="profile-theme-control">${themeControl()}</div>
      </div>
      <div class="card">
        <span class="eyebrow">PROGRESSO</span>
        <h3>${prog.pct}% concluído</h3>
        <div class="progress-track"><span style="width:${prog.pct}%"></span></div>
        <div class="small top-gap">${prog.done} de ${prog.total} células concluídas</div>
      </div>
    </div>
    <div class="section">${progressPanel()}</div>
    <div class="section"><div class="card"><button id="resetApp" class="ghost">Restaurar dados de exemplo</button></div></div>
  `,"Perfil")
}
function supabaseIsConfigured(){
  const cfg=window.APP_CONFIG||{};
  return !!cfg.SUPABASE_URL&&
    !!cfg.SUPABASE_ANON_KEY&&
    !String(cfg.SUPABASE_URL).includes("COLE_AQUI")&&
    !String(cfg.SUPABASE_ANON_KEY).includes("COLE_AQUI");
}
function setAuthMessage(id,text,type="error"){
  const el=$(id);
  if(!el)return;
  el.textContent=text;
  el.className=`auth-message ${type}`;
}
function clearAuthMessages(){
  for(const id of ["loginMessage","signupMessage"]){
    const el=$(id);
    if(el){el.textContent="";el.className="auth-message hidden"}
  }
}
function selectAuthTab(tab){
  const login=tab==="login";
  $("loginTab").classList.toggle("active",login);
  $("signupTab").classList.toggle("active",!login);
  $("loginForm").classList.toggle("hidden",!login);
  $("signupForm").classList.toggle("hidden",login);
  clearAuthMessages();
  // Ao trocar manualmente de aba, não deixe um fluxo anterior bloquear o login.
  authFlowLock=null;
  pendingAuthUser=null;
  pendingAuthEmail="";
}
function showAuth(){
  $("authScreen").classList.remove("hidden");
  $("app").classList.add("hidden");
  document.body.classList.add("auth-active");
}
function hideAuth(){
  $("authScreen").classList.add("hidden");
  $("app").classList.remove("hidden");
  document.body.classList.remove("auth-active");
}
function currentAccountName(){
  return currentUser?.user_metadata?.full_name||
    data.profile?.full_name||
    currentUser?.email?.split("@")[0]||
    "Aluno";
}
function updateAccountUI(){
  if(!currentUser)return;
  const name=currentAccountName();
  const initial=(name.trim().charAt(0)||"A").toUpperCase();
  if($("accountModalName"))$("accountModalName").textContent=name;
  if($("accountFullName"))$("accountFullName").textContent=name;
  if($("accountEmail"))$("accountEmail").textContent=currentUser.email||"";
  if($("accountAvatar"))$("accountAvatar").textContent=initial;
}
async function loadUserWorkspace(){
  data=localStateForUser(currentUser.id);

  try{
    cloudReady=true;
    const cloud=await readCloudState();
    if(cloud){
      data=cloud;
      cacheCurrentState();
    }else{
      await writeCloudState();
    }
  }catch(err){
    console.error("Falha ao carregar estado da nuvem:",err);
    cloudReady=false;
  }

  const accountName=currentUser?.user_metadata?.full_name;
  if(accountName){
    data.profile=data.profile||structuredClone(demo.profile);
    if(!data.profile.full_name||data.profile.full_name==="Aluno")data.profile.full_name=accountName;
  }
}
async function startAuthenticatedSession(user){
  currentUser=user;
  await loadUserWorkspace();
  hideAuth();
  render();
  updateAccountUI();
}
function bindAuthenticationUI(){
  $("loginTab").onclick=()=>selectAuthTab("login");
  $("signupTab").onclick=()=>selectAuthTab("signup");
  $("loginForm").onsubmit=submitLogin;
  $("signupForm").onsubmit=submitSignup;
  $("logoutButton").onclick=logoutCurrentUser;

  document.querySelectorAll("[data-password-target]").forEach(button=>{
    button.onclick=()=>{
      const input=$(button.dataset.passwordTarget);
      if(!input)return;
      const reveal=input.type==="password";
      input.type=reveal?"text":"password";
      button.textContent=reveal?"Ocultar":"Mostrar";
    };
  });

  document.addEventListener("click",event=>{
    if(event.target.closest("[data-account]")){
      updateAccountUI();
      openModal("accountModal");
    }
  });
}

async function initializeAuth(){
  if(!supabaseIsConfigured()){
    showAuth();
    setAuthMessage("loginMessage","Para ativar contas privadas, configure o Supabase no arquivo config.js.","warning");
    $("loginSubmit").disabled=true;
    $("signupSubmit").disabled=true;
    return;
  }

  supabaseClient=window.supabase.createClient(
    window.APP_CONFIG.SUPABASE_URL,
    window.APP_CONFIG.SUPABASE_ANON_KEY,
    {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}
  );

  const {data:{session},error}=await supabaseClient.auth.getSession();
  if(error)console.error(error);

  if(session?.user)await startAuthenticatedSession(session.user);
  else showAuth();

  supabaseClient.auth.onAuthStateChange((event,session)=>{
    if(session?.user){
      // Durante cadastro/login iniciado pelo usuário, a própria função do formulário
      // controla a mensagem de sucesso e só libera o cronograma após confirmação.
      if(authFlowLock){
        pendingAuthUser=session.user;
        return;
      }
      if(!currentUser||currentUser.id!==session.user.id){
        // Evita executar consultas ao banco dentro do callback de Auth.
        setTimeout(()=>startAuthenticatedSession(session.user).catch(err=>{
          console.error("Falha ao iniciar sessão autenticada:",err);
          showAuth();
          setAuthMessage("loginMessage","Login confirmado, mas não foi possível carregar seu cronograma. Tente novamente.","error");
        }),0);
      }
    }else{
      currentUser=null;
      cloudReady=false;
      data=structuredClone(demo);
      showAuth();
    }
  });
}
async function submitLogin(event){
  event.preventDefault();
  clearAuthMessages();
  if(!supabaseClient){
    setAuthMessage("loginMessage","A conexão com o Supabase ainda não foi iniciada. Recarregue a página.","error");
    return;
  }

  const email=$("loginEmail").value.trim();
  const password=$("loginPassword").value;
  const btn=$("loginSubmit");
  btn.disabled=true;
  btn.textContent="Entrando…";
  authFlowLock="login";
  pendingAuthUser=null;
  pendingAuthEmail=email;

  try{
    const {data:result,error}=await supabaseClient.auth.signInWithPassword({email,password});
    if(error)throw error;

    const user=result?.user||result?.session?.user||pendingAuthUser;
    if(!user){
      throw new Error("O Supabase confirmou o login, mas não retornou o usuário da sessão.");
    }
    pendingAuthUser=user;
    showLoginSuccessConfirmation(user);
  }catch(error){
    authFlowLock=null;
    pendingAuthUser=null;
    pendingAuthEmail="";
    const message=error?.message==="Invalid login credentials"
      ?"E-mail ou senha incorretos."
      :error?.message||"Não foi possível realizar o login.";
    setAuthMessage("loginMessage",message,"error");
  }finally{
    btn.disabled=false;
    btn.textContent="Entrar no meu cronograma";
  }
}

async function submitSignup(event){
  event.preventDefault();
  clearAuthMessages();
  if(!supabaseClient){
    setAuthMessage("signupMessage","A conexão com o Supabase ainda não foi iniciada. Recarregue a página.","error");
    return;
  }

  const name=$("signupName").value.trim();
  const email=$("signupEmail").value.trim();
  const password=$("signupPassword").value;
  const confirm=$("signupPasswordConfirm").value;

  if(password!==confirm){
    setAuthMessage("signupMessage","As senhas não coincidem.","error");
    return;
  }

  const btn=$("signupSubmit");
  btn.disabled=true;
  btn.textContent="Criando conta…";
  authFlowLock="signup";
  pendingAuthUser=null;
  pendingAuthEmail=email;

  try{
    const {data:result,error}=await supabaseClient.auth.signUp({
      email,
      password,
      options:{data:{full_name:name}}
    });
    if(error)throw error;

    pendingAuthUser=result?.user||result?.session?.user||pendingAuthUser;
    showAccountCreatedConfirmation(!!result?.session,email);
  }catch(error){
    authFlowLock=null;
    pendingAuthUser=null;
    pendingAuthEmail="";
    setAuthMessage("signupMessage",error?.message||"Não foi possível criar a conta.","error");
  }finally{
    btn.disabled=false;
    btn.textContent="Criar minha conta";
  }
}

function finishAuthFlow(){
  authFlowLock=null;
  pendingAuthUser=null;
  pendingAuthEmail="";
}

function showLoginSuccessConfirmation(user){
  const title=$("loginSuccessTitle");
  const message=$("loginSuccessMessage");
  const action=$("loginSuccessAction");
  if(!title||!message||!action){
    // Fallback: nunca deixe o usuário preso se o modal não estiver no HTML.
    const saved=user;
    finishAuthFlow();
    return startAuthenticatedSession(saved);
  }

  const name=user?.user_metadata?.full_name||user?.email?.split("@")[0]||"Aluno";
  title.textContent="Login realizado com sucesso!";
  message.textContent=`Bem-vindo, ${name}. Sua conta foi autenticada e seu cronograma está pronto para carregar.`;
  action.textContent="Entrar no meu cronograma";
  action.onclick=async()=>{
    const saved=pendingAuthUser||user;
    closeModals();
    finishAuthFlow();
    action.disabled=true;
    try{
      await startAuthenticatedSession(saved);
      toast("Login realizado com sucesso.");
    }catch(err){
      console.error("Falha ao carregar cronograma após login:",err);
      showAuth();
      setAuthMessage("loginMessage","Login realizado, mas houve um erro ao carregar o cronograma. Recarregue a página e tente novamente.","error");
    }finally{
      action.disabled=false;
    }
  };
  openModal("loginSuccessModal");
}

function showAccountCreatedConfirmation(hasSession,email){
  const title=$("accountCreatedTitle");
  const message=$("accountCreatedMessage");
  const note=$("accountCreatedNote");
  const action=$("accountCreatedAction");
  if(!title||!message||!note||!action){
    finishAuthFlow();
    setAuthMessage("signupMessage","Conta criada com sucesso.","success");
    return;
  }

  title.textContent="Conta criada com sucesso!";
  if(hasSession){
    message.textContent="Seu cadastro foi concluído e seu espaço acadêmico já está pronto para uso.";
    note.textContent="Sua conta já está autenticada. Clique abaixo para abrir o cronograma.";
    action.textContent="Acessar meu cronograma";
    action.onclick=async()=>{
      const saved=pendingAuthUser;
      closeModals();
      finishAuthFlow();
      if(saved){
        await startAuthenticatedSession(saved);
        toast("Conta criada e login realizado com sucesso.");
      }else{
        const {data:{session}}=await supabaseClient.auth.getSession();
        if(session?.user){
          await startAuthenticatedSession(session.user);
          toast("Conta criada e login realizado com sucesso.");
        }else{
          showAuth();
          selectAuthTab("login");
          $("loginEmail").value=email;
          setAuthMessage("loginMessage","Conta criada com sucesso. Agora faça login.","success");
        }
      }
    };
  }else{
    message.textContent=`Sua conta foi criada. Enviamos uma confirmação para ${email}.`;
    note.textContent="Abra seu e-mail, confirme o cadastro e depois volte para entrar na sua conta.";
    action.textContent="Ir para entrar";
    action.onclick=()=>{
      closeModals();
      finishAuthFlow();
      showAuth();
      selectAuthTab("login");
      $("loginEmail").value=email;
      setAuthMessage("loginMessage","Conta criada com sucesso. Confirme seu e-mail e depois faça login.","success");
    };
  }
  openModal("accountCreatedModal");
}

async function logoutCurrentUser(){
  if(!supabaseClient)return;
  finishAuthFlow();
  try{await writeCloudState()}catch(e){}
  await supabaseClient.auth.signOut();
  closeModals();
}function render(){applyTheme();const map={hoje,semana,mes,semestre,calendario,disciplinas,arquivos,perfil,disciplina};$("app").innerHTML=map[view]();bindDynamic()}
function bindDynamic(){
 bindAgendaTools();document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{view=b.dataset.view;render()});document.querySelectorAll("[data-new-subject]").forEach(b=>b.onclick=()=>openSubjectEditor());document.querySelectorAll("[data-import]").forEach(b=>b.onclick=()=>openImport());document.querySelectorAll("[data-subject]").forEach(el=>el.onclick=e=>{if(e.target.closest("button"))return;selectedSubject=el.dataset.subject;view="disciplina";render()});document.querySelectorAll("[data-edit-subject]").forEach(b=>b.onclick=e=>{e.stopPropagation();openSubjectEditor(b.dataset.editSubject)});document.querySelectorAll("[data-update-subject]").forEach(b=>b.onclick=e=>{e.stopPropagation();openImport(b.dataset.updateSubject)});document.querySelectorAll("[data-delete-subject]").forEach(b=>b.onclick=e=>{e.stopPropagation();requestDeleteSubject(b.dataset.deleteSubject)});document.querySelectorAll("[data-edit-item]").forEach(b=>b.onclick=e=>{e.stopPropagation();openItem(b.dataset.editItem)});document.querySelectorAll("[data-delete-item]").forEach(b=>b.onclick=e=>{e.stopPropagation();requestDeleteItem(b.dataset.deleteItem)});document.querySelectorAll("[data-toggle-complete]").forEach(b=>b.onclick=e=>{e.stopPropagation();requestToggleComplete(b.dataset.toggleComplete)});document.querySelectorAll("[data-view-item]").forEach(b=>b.onclick=e=>{e.stopPropagation();openItemView(b.dataset.viewItem)});document.querySelectorAll("[data-item]").forEach(el=>el.onclick=e=>{if(e.target.closest("button"))return;openItemView(el.dataset.item)});document.querySelectorAll("[data-add-item]").forEach(b=>b.onclick=()=>openNewItem(b.dataset.addItem));if($("prev"))$("prev").onclick=()=>{cursor=new Date(cursor.getFullYear(),cursor.getMonth()-1,1);render()};if($("next"))$("next").onclick=()=>{cursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1);render()};if($("editProfile"))$("editProfile").onclick=openProfile;if($("resetApp"))$("resetApp").onclick=()=>confirmAction("Limpar todos os dados","Isso apagará disciplinas, cronogramas e arquivos salvos neste navegador. Deseja continuar?",()=>{data=structuredClone(demo);save();view="hoje";selectedSubject=null;render();toast("Dados locais apagados.")},"Sim, limpar tudo")}
function openSubjectEditor(id=""){
  const s=id?subject(id):null;
  $("subjectId").value=s?.id||"";
  $("subjectName").value=s?.name||"";
  $("subjectTeacher").value=s?.teacher||"";
  $("subjectWorkload").value=s?.workload||"";
  $("subjectColor").value=s?.color||"#6C5CE7";
  $("subjectModalTitle").textContent=s?"Editar disciplina":"Nova disciplina";

  if($("subjectFileSection"))$("subjectFileSection").classList.toggle("hidden",!!s);
  if($("saveAndImportSubject"))$("saveAndImportSubject").classList.toggle("hidden",!!s);
  if($("subjectScheduleFile"))$("subjectScheduleFile").value="";
  if($("subjectSelectedFileName"))$("subjectSelectedFileName").textContent="Selecionar cronograma";

  openModal("subjectModal");
}
function saveSubject(){const id=$("subjectId").value,name=$("subjectName").value.trim();if(!name)return toast("Informe o nome da disciplina.");if(id){Object.assign(subject(id),{name,teacher:$("subjectTeacher").value.trim(),workload:$("subjectWorkload").value.trim(),color:$("subjectColor").value})}else{data.subjects.push({id:uid("s"),name,teacher:$("subjectTeacher").value.trim(),workload:$("subjectWorkload").value.trim(),color:$("subjectColor").value})}save();closeModals();render();toast(id?"Disciplina atualizada.":"Disciplina criada.")}
async function readSelectedSubjectSchedule(file,subjectId){
  openImport(subjectId);
  if($("selectedFileName"))$("selectedFileName").textContent=file.name;
  $("analyzeFile").disabled=true;
  $("analyzeFile").textContent="Interpretando cronograma…";

  try{
    const read=await readFile(file);
    const parsed=interpretAcademicSchedule(read,subjectId,file);
    normalizeImportedAcademicYear(parsed);

    if(!parsed.length){
      const hdr=read.headers?.length?` Cabeçalhos encontrados: ${read.headers.map(escapeHtml).join(" • ")}.`:"";
      showImportResult("warning",`O arquivo foi lido, mas não encontrei registros acadêmicos confiáveis.${hdr} A disciplina foi criada sem alterar o cronograma.`);
      return;
    }

    data.files.push({id:uid("f"),name:file.name,type:file.name.split(".").pop().toUpperCase(),subject_id:subjectId});
    const existing=data.items.filter(x=>x.subject_id===subjectId);
    showImportPreview(parsed,existing,file,subjectId,null,read);
  }catch(e){
    showImportResult("warning",`Não foi possível interpretar o arquivo: ${escapeHtml(e.message||String(e))}`);
  }finally{
    $("analyzeFile").disabled=false;
    $("analyzeFile").textContent="Ler e organizar arquivo";
  }
}
async function createSubjectAndImport(){
  const file=$("subjectScheduleFile")?.files?.[0];
  if(!file){
    toast("Selecione o cronograma desta disciplina.");
    return;
  }

  const name=$("subjectName").value.trim();
  if(!name){
    toast("Informe o nome da disciplina.");
    return;
  }

  const created={
    id:uid("s"),
    name,
    teacher:$("subjectTeacher").value.trim(),
    workload:$("subjectWorkload").value.trim(),
    color:$("subjectColor").value
  };
  data.subjects.push(created);
  save();
  closeModals();
  render();

  await readSelectedSubjectSchedule(file,created.id);
}
function requestDeleteSubject(id){const s=subject(id);if(!s)return;const count=data.items.filter(x=>x.subject_id===id).length;confirmAction("Apagar disciplina?",`A disciplina “${s.name}” possui ${count} item(ns) no cronograma. A confirmação apagará a disciplina e todas as células vinculadas a ela.`,()=>{data.subjects=data.subjects.filter(x=>x.id!==id);data.items=data.items.filter(x=>x.subject_id!==id);data.files=data.files.filter(x=>x.subject_id!==id);if(selectedSubject?.id===id){selectedSubject=null;view="disciplinas"}save();render();toast("Disciplina apagada.")})}
function openNewItem(subjectId){$("itemId").value="";$("itemLesson").value="";$("itemDate").value=CURRENT_DATE;$("itemContent").value="";$("itemStrategy").value="";$("itemAssessment").value="";$("itemBibliography").value="";$("itemType").value="aula";$("itemPoints").value="";$("itemModalTitle").textContent="Nova célula";$("itemModal").dataset.subjectId=subjectId;$("deleteItem").classList.add("hidden");openModal("itemModal")}
function openItemView(id){
  const x=data.items.find(i=>i.id===id);if(!x)return;
  const s=subject(x.subject_id);
  $("viewItemTitle").textContent=s?.name||"Disciplina";
  $("viewItemSubject").textContent=s?.name||"Disciplina";
  $("viewItemDate").textContent=fmt(x.event_date);
  $("viewItemLesson").textContent=x.lesson_number||"Não informado";
  $("viewItemType").textContent=x.type||"aula";
  $("viewItemContent").textContent=x.content||"Não informado";
  $("viewItemStrategy").textContent=x.teaching_strategy||"Não informado";
  $("viewItemAssessment").textContent=x.assessment||"Não informado";
  $("viewItemBibliography").textContent=x.bibliography||"Não informada";
  if($("viewItemCompletion")){
    $("viewItemCompletion").textContent=x.completed?"Concluída":"Pendente";
    $("viewItemCompletion").className=`completion-status ${x.completed?"done":"pending"}`;
  }
  if($("toggleCompleteFromView")){
    $("toggleCompleteFromView").textContent=x.completed?"Reabrir célula":"✓ Marcar como concluída";
    $("toggleCompleteFromView").onclick=()=>{closeModals();requestToggleComplete(id)};
  }
  $("editFromView").onclick=()=>{closeModals();openItem(id)};
  openModal("itemViewModal")
}
function openItem(id){const x=data.items.find(i=>i.id===id);if(!x)return;$("itemId").value=id;$("itemLesson").value=x.lesson_number||"";$("itemDate").value=x.event_date;$("itemContent").value=x.content||"";$("itemStrategy").value=x.teaching_strategy||"";$("itemAssessment").value=x.assessment||"";$("itemBibliography").value=x.bibliography||"";$("itemType").value=x.type;$("itemPoints").value=x.points??"";$("itemModalTitle").textContent="Editar célula";$("deleteItem").classList.remove("hidden");openModal("itemModal")}
function saveItem(){const id=$("itemId").value;const payload={lesson_number:$("itemLesson").value.trim(),event_date:$("itemDate").value,source_date_text:$("itemDate").value,calendar_dates:parseCalendarDates($("itemDate").value),content:$("itemContent").value.trim()||"Sem conteúdo",teaching_strategy:$("itemStrategy").value.trim(),assessment:$("itemAssessment").value.trim(),bibliography:$("itemBibliography").value.trim(),type:$("itemType").value,points:$("itemPoints").value?Number($("itemPoints").value):null,manually_edited:true};if(!payload.event_date)return toast("Informe a data da célula.");if(id)Object.assign(data.items.find(x=>x.id===id),payload);else data.items.push({id:uid("i"),subject_id:$("itemModal").dataset.subjectId,completed:false,...payload});save();closeModals();render();toast(id?"Célula atualizada.":"Célula adicionada.")}
function requestDeleteItem(id){const x=data.items.find(i=>i.id===id);if(!x)return;confirmAction("Apagar célula?",`Você está prestes a apagar “${x.content}” (${fmt(x.event_date)}). Deseja continuar?`,()=>{data.items=data.items.filter(i=>i.id!==id);save();render();toast("Célula apagada.")})}
function openImport(subjectId=""){const existing=data.subjects.length>0;$("importSubject").innerHTML=data.subjects.map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");$("importMode").value=existing?"existing":"new";if(subjectId)$("importSubject").value=subjectId;syncImportMode();$("scheduleFile").value="";$("selectedFileName").textContent="Selecione o arquivo do cronograma";$("newImportSubjectName").value="";$("importResult").className="import-result hidden";$("importResult").innerHTML="";openModal("importModal")}
function syncImportMode(){const isNew=$("importMode").value==="new"||!data.subjects.length;$("newImportSubjectWrap").classList.toggle("hidden",!isNew);$("existingSubjectWrap").classList.toggle("hidden",isNew);if(!data.subjects.length)$("importMode").value="new"}
function guessSubjectName(name){return name.replace(/\.[^.]+$/," ").replace(/cronograma|de aulas|faresi|faculdade|2026\.2/gi," ").replace(/[_-]+/g," ").replace(/\s+/g," ").trim().slice(0,120)}
function getAcademicYear(fileName=""){
  const fromName=String(fileName).match(/\b(20\d{2})\b/);
  if(fromName)return Number(fromName[1]);
  const period=String(data.profile?.academic_period||"").match(/\b(20\d{2})\b/);
  return period?Number(period[1]):new Date().getFullYear();
}
function xmlText(node){
  if(!node)return"";
  const parts=[];
  const walk=n=>{
    if(n.nodeType!==1)return;
    const name=n.localName;
    if(name==="t")parts.push(n.textContent||"");
    else if(name==="tab")parts.push("\t");
    else if(name==="br"||name==="cr")parts.push("\n");
    else [...n.children].forEach(walk);
  };
  walk(node);
  return parts.join("").replace(/\u00a0/g," ").replace(/[ \t]+\n/g,"\n").trim();
}
function cellParagraphText(tc){
  const ps=[...tc.children].filter(x=>x.localName==="p");
  const parts=ps.map(p=>xmlText(p)).filter(Boolean);
  return parts.join("\n").replace(/\n{3,}/g,"\n\n").trim();
}
function wordCellProps(tc){
  const tcPr=[...tc.children].find(x=>x.localName==="tcPr");
  let span=1,vMerge=null;
  if(tcPr){
    const gs=[...tcPr.children].find(x=>x.localName==="gridSpan");
    if(gs){const a=[...gs.attributes].find(a=>a.localName==="val");span=Math.max(1,Number(a?.value||1)||1)}
    const vm=[...tcPr.children].find(x=>x.localName==="vMerge");
    if(vm){const a=[...vm.attributes].find(a=>a.localName==="val");vMerge=a?.value||"continue"}
  }
  return {span,vMerge};
}
function buildWordTableMatrix(tbl){
  const trs=[...tbl.children].filter(x=>x.localName==="tr"),matrix=[];
  for(const tr of trs){
    const row=[];
    const cells=[...tr.children].filter(x=>x.localName==="tc");
    for(const tc of cells){
      const {span}=wordCellProps(tc);
      const text=cellParagraphText(tc);
      row.push(text);
      for(let j=1;j<span;j++)row.push("");
    }
    matrix.push(row);
  }
  return matrix;
}
function canonicalHeaderKind(value){
  const raw=String(value??"").trim();
  const h=normalizeHeader(value);
  if(raw==="#"||aliases.lesson.includes(h))return"lesson";
  if(aliases.date.includes(h))return"date";
  if(aliases.content.includes(h))return"content";
  if(aliases.strategy.includes(h))return"strategy";
  if(aliases.assessment.includes(h))return"assessment";
  if(aliases.bibliography.includes(h))return"bibliography";
  if(aliases.points.includes(h))return"points";
  if(aliases.type.includes(h))return"type";
  return"unknown";
}
function isUsableHeaderKinds(kinds){
  return kinds.includes("lesson")&&kinds.includes("date")&&kinds.includes("content")&&kinds.filter(k=>k!=="unknown").length>=5;
}
function rowObjectFromKinds(values,kinds,headers){
  const obj={};
  for(let i=0;i<Math.max(values.length,kinds.length);i++){
    const key=headers[i]||`Coluna ${i+1}`;
    obj[key]=String(values[i]??"").replace(/\u00a0/g," ").trim();
  }
  return obj;
}
function extractMetaFromText(text){
  const t=String(text||"").replace(/\u00a0/g," ").replace(/\r/g," ");
  const meta={};
  const dm=t.match(/Disciplina:\s*([\s\S]*?)(?=\s+Carga\s*Hor[aá]ria:|\s+Horas-aula\/semanal:|\n|$)/i);
  const wm=t.match(/Carga\s*Hor[aá]ria:\s*([\s\S]*?)(?=\s+Horas-aula\/semanal:|\n|$)/i);
  const sm=t.match(/Semestre:\s*([^\n]+)/i);
  const cm=t.match(/Curso:\s*([\s\S]*?)(?=\s+Semestre:|\n|$)/i);
  if(dm)meta.subjectName=dm[1].replace(/\s+/g," ").trim();
  if(wm)meta.workload=wm[1].replace(/\s+/g," ").trim();
  if(sm)meta.semester=sm[1].replace(/\s+/g," ").trim();
  if(cm)meta.course=cm[1].replace(/\s+/g," ").trim();
  return meta;
}
function mergeMeta(target,source){
  for(const [k,v] of Object.entries(source||{}))if(v&&!target[k])target[k]=v;
  return target;
}
function isAdministrativeOnlyValues(values){
  const joined=values.filter(Boolean).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
  return /^(orientacao|extensao|orientacao extensao|intervalo)$/.test(joined);
}
function appendRowObjectCell(row,key,value){
  const v=String(value??"").replace(/\u00a0/g," ").trim();
  if(!v)return;
  const prev=String(row[key]??"").trim();
  if(!prev)row[key]=v;
  else if(prev!==v&&!prev.endsWith("\n"+v))row[key]=`${prev}\n${v}`;
}
function parseDocxTablesInDocumentOrder(dom){
  const tables=[...dom.getElementsByTagNameNS("*","tbl")];
  let activeKinds=null,activeHeaders=null,lastRow=null;
  const rows=[],allHeaders=[];

  for(const tbl of tables){
    const matrix=buildWordTableMatrix(tbl);

    for(const physical of matrix){
      const values=physical.map(v=>String(v??"").replace(/\u00a0/g," ").trim());
      if(!values.some(Boolean))continue;

      const kinds=values.map(canonicalHeaderKind);
      const recognized=kinds.filter(k=>k!=="unknown").length;
      const looksHeader=kinds.includes("date")&&
        (kinds.includes("content")||kinds.includes("assessment")||kinds.includes("strategy"))&&
        recognized>=3;

      if(looksHeader){
        activeKinds=kinds;
        activeHeaders=values.map((v,i)=>v||`Coluna ${i+1}`);
        allHeaders.splice(0,allHeaders.length,...activeHeaders);
        lastRow=null;
        continue;
      }

      if(!activeKinds||!activeHeaders)continue;
      if(isAdministrativeOnlyValues(values))continue;

      while(values.length<activeKinds.length)values.push("");

      const obj=rowObjectFromKinds(values,activeKinds,activeHeaders);
      const dateIndex=activeKinds.indexOf("date");
      const lessonIndex=activeKinds.indexOf("lesson");
      const dateValue=dateIndex>=0?values[dateIndex]:"";
      const lessonValue=lessonIndex>=0?values[lessonIndex]:"";
      const hasDate=!!parseDate(dateValue||"");
      const looksNewLesson=/^\s*\d{1,3}(?:\s*[,;/\-]\s*\d{1,3})*\s*$/.test(String(lessonValue||""));

      if(hasDate||looksNewLesson){
        rows.push(obj);
        lastRow=obj;
        continue;
      }

      // Linha sem data depois de uma aula: trata como continuação daquela mesma célula.
      // Isso cobre DOCX com células divididas entre páginas, quebras de tabela ou referências longas.
      if(lastRow){
        for(let i=0;i<activeKinds.length;i++){
          const val=values[i];
          if(!val)continue;
          const key=activeHeaders[i]||`Coluna ${i+1}`;
          appendRowObjectCell(lastRow,key,val);
        }
      }
    }
  }
  return {rows,headers:allHeaders};
}
function htmlTableMatrix(table){
  return [...table.querySelectorAll("tr")].map(tr=>
    [...tr.children].filter(c=>/^(TD|TH)$/.test(c.tagName)).map(c=>
      (c.innerText||c.textContent||"").replace(/\u00a0/g," ").replace(/\n{3,}/g,"\n\n").trim()
    )
  );
}
async function readDocxStructured(file){
  if(!window.JSZip)throw new Error("Leitor DOCX não carregado. Atualize a página e tente novamente.");
  const buffer=await file.arrayBuffer(),zip=await JSZip.loadAsync(buffer);
  const docEntry=zip.file("word/document.xml");
  if(!docEntry)throw new Error("Este DOCX não possui document.xml válido.");
  const xml=await docEntry.async("text");
  const dom=new DOMParser().parseFromString(xml,"application/xml");
  if(dom.querySelector("parsererror"))throw new Error("Não foi possível interpretar a estrutura XML do DOCX.");
  const parsed=parseDocxTablesInDocumentOrder(dom);
  let rawText="",meta={};
  const documentText=[...dom.getElementsByTagNameNS("*","t")].map(n=>n.textContent||"").join(" ");
  mergeMeta(meta,extractMetaFromText(documentText));
  if(window.mammoth){
    try{
      const raw=await mammoth.extractRawText({arrayBuffer:buffer.slice(0)});
      rawText=raw.value||"";
      mergeMeta(meta,extractMetaFromText(rawText));
    }catch(e){}
  }
  const metaYear=String(meta.semester||"").match(/\b(20\d{2})\b/);
  return{
    rows:parsed.rows,
    text:rawText||documentText,
    ext:"docx",
    meta,
    year:metaYear?Number(metaYear[1]):getAcademicYear(file.name),
    docxSource:"word-table-document-order",
    headers:parsed.headers
  };
}
async function readPptxStructured(file){
  if(!window.JSZip)throw new Error("Leitor PPTX não carregado.");
  const zip=await JSZip.loadAsync(await file.arrayBuffer());
  const slideNames=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
  const slides=[];
  for(const name of slideNames){const xml=await zip.file(name).async("text");const dom=new DOMParser().parseFromString(xml,"application/xml");slides.push([...dom.getElementsByTagNameNS("*","t")].map(x=>x.textContent||"").join(" "))}
  return {text:slides.join("\n"),rows:null,ext:"pptx",meta:{},year:getAcademicYear(file.name)};
}
function normalizePdfToken(s){
  return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
}
function pdfInstitutionalLine(text){
  const n=normalizePdfToken(text);
  return !n||
    n.includes("faculdade da regiao sisaleira")||
    n.includes("portaria de credenciamento")||
    n.includes("rua senhora de santana")||
    n.includes("telefone:")||
    n.includes("contato@faresi")||
    /^faresi\b/.test(n);
}
function pdfAdministrativeLine(text){
  const n=normalizePdfToken(text).replace(/[^a-z0-9 ]/g,"").trim();
  return n==="orientacao"||n==="extensao"||n==="orientacao extensao";
}
function groupPdfLines(items,tolerance=2.6){
  const sorted=[...items].sort((a,b)=>Math.abs(b.y-a.y)>tolerance?b.y-a.y:a.x-b.x);
  const lines=[];
  for(const it of sorted){
    let line=lines.find(l=>Math.abs(l.y-it.y)<=tolerance);
    if(!line){line={y:it.y,items:[]};lines.push(line)}
    line.items.push(it);
  }
  return lines.sort((a,b)=>b.y-a.y).map(l=>({...l,items:l.items.sort((a,b)=>a.x-b.x)}));
}
function appendPdfCell(record,key,text){
  const clean=String(text||"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim();
  if(!clean)return;
  const prev=String(record[key]||"").trim();
  if(prev===clean||prev.endsWith("\n"+clean))return;
  record[key]=prev?`${prev}\n${clean}`:clean;
}
async function detectPdfGridBoundaries(page){
  const scale=2;
  const viewport=page.getViewport({scale});
  const canvas=document.createElement("canvas");
  canvas.width=Math.ceil(viewport.width);
  canvas.height=Math.ceil(viewport.height);
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  await page.render({canvasContext:ctx,viewport}).promise;

  // A grade acadêmica da FARESI pode começar antes dos últimos 28% da página.
  // Escaneamos desde 58% da altura, evitando a maior parte do cabeçalho institucional
  // e preservando uma área vertical suficiente para encontrar as linhas da tabela.
  const yStart=Math.floor(canvas.height*0.58);
  const yEnd=Math.floor(canvas.height*0.997);
  const img=ctx.getImageData(0,yStart,canvas.width,yEnd-yStart);
  const data=img.data,w=canvas.width,h=yEnd-yStart;

  // Uma linha vertical não precisa ocupar 8% da página inteira.
  // 4,5% permite reconhecer grades com poucas linhas na primeira página.
  const threshold=Math.max(30,Math.floor(canvas.height*0.045));
  const candidates=[];

  for(let x=0;x<w;x++){
    let run=0,maxRun=0;
    for(let y=0;y<h;y++){
      const i=(y*w+x)*4;
      const gray=(data[i]+data[i+1]+data[i+2])/3;
      if(gray<235){
        run++;
        if(run>maxRun)maxRun=run;
      }else run=0;
    }
    if(maxRun>=threshold)candidates.push(x);
  }

  const clusters=[];
  for(const x of candidates){
    if(!clusters.length||x-clusters[clusters.length-1][clusters[clusters.length-1].length-1]>3)clusters.push([x]);
    else clusters[clusters.length-1].push(x);
  }
  let centers=clusters.map(c=>c.reduce((a,b)=>a+b,0)/c.length);

  // Procura uma sequência plausível de 7 linhas para 6 colunas.
  if(centers.length>=7){
    let best=null;
    for(let i=0;i<=centers.length-7;i++){
      const seq=centers.slice(i,i+7);
      const widths=seq.slice(1).map((v,j)=>v-seq[j]);
      const total=seq[6]-seq[0];
      const valid=
        widths.every(v=>v>canvas.width*0.025)&&
        total>canvas.width*0.72&&
        seq[0]<canvas.width*0.12&&
        seq[6]>canvas.width*0.86;
      if(!valid)continue;
      const score=total;
      if(!best||score>best.score)best={seq,score};
    }
    if(best)centers=best.seq;
  }

  if(centers.length===7){
    return{
      boundaries:centers.map(x=>x/scale),
      pageWidth:viewport.width/scale,
      source:"rendered-table-grid-v2"
    };
  }

  // FALLBACK FARESI:
  // Se o navegador não conseguir detectar as linhas no canvas, verificamos se
  // o PDF possui o cabeçalho canônico da FARESI e usamos as proporções da grade.
  // Isso evita que um PDF textual válido seja rejeitado apenas por renderização.
  const tc=await page.getTextContent();
  const text=tc.items.map(i=>String(i.str||"")).join(" ");
  const normalized=normalizePdfToken(text);
  const canonical=
    normalized.includes("aula")&&
    normalized.includes("data")&&
    normalized.includes("conteudo")&&
    normalized.includes("estrategias de ensino")&&
    normalized.includes("avaliacao")&&
    normalized.includes("bibliografia");

  if(canonical){
    const pw=viewport.width/scale;
    // Proporções medidas na grade institucional de 6 colunas da FARESI.
    const ratios=[0.0392,0.0981,0.1823,0.3591,0.5108,0.6369,0.9574];
    return{
      boundaries:ratios.map(r=>pw*r),
      pageWidth:pw,
      source:"faresi-canonical-fallback"
    };
  }

  return null;
}
function classifyByRealGrid(x,bounds){
  // bounds = 7 linhas verticais reais da tabela
  for(let i=0;i<6;i++){
    if(x>=bounds[i]-1&&x<bounds[i+1]-1)return i;
  }
  return -1;
}
function lineCellsUsingRealGrid(line,bounds){
  const cells=Array.from({length:6},()=>[]);
  for(const it of line.items){
    const idx=classifyByRealGrid(it.x,bounds);
    if(idx>=0)cells[idx].push(it.str);
  }
  return cells.map(parts=>parts.join(" ").replace(/\s+/g," ").trim());
}
function isPdfTableHeader(cells){
  const text=cells.map(normalizePdfToken).join(" | ");
  return (
    text.includes("aula")&&
    text.includes("data")&&
    (text.includes("conteudo")||text.includes("tema/conteudo"))&&
    (text.includes("estrategia")||text.includes("estrategias"))&&
    (text.includes("avaliacao")||text.includes("atividade"))&&
    (text.includes("bibliografia")||text.includes("referencia"))
  );
}
function canonicalFaresiPdfGrid(pageWidth){
  // Proporções da grade canônica de 6 colunas:
  // Aula nº | Data | Conteúdo | Estratégias | Avaliação | Bibliografia
  return{
    boundaries:[
      pageWidth*0.0392,
      pageWidth*0.0981,
      pageWidth*0.1823,
      pageWidth*0.3591,
      pageWidth*0.5108,
      pageWidth*0.6369,
      pageWidth*0.9574
    ],
    pageWidth,
    source:"canonical-six-column-fallback"
  };
}
function pdfHasCanonicalSixColumnHeader(text){
  const n=normalizePdfToken(text);
  return n.includes("aula")&&
    n.includes("data")&&
    n.includes("conteudo")&&
    (n.includes("estrategias de ensino")||n.includes("estrategias"))&&
    n.includes("avaliacao")&&
    n.includes("bibliografia");
}
function parsePdfPagesWithGrid(pages,grid){
  const rows=[];
  let active=null;

  for(const pageData of pages){
    const lines=groupPdfLines(pageData.items);

    for(const line of lines){
      const full=line.items.map(i=>i.str).join(" ").replace(/\s+/g," ").trim();
      if(pdfInstitutionalLine(full))continue;

      const cells=lineCellsUsingRealGrid(line,grid.boundaries);
      if(isPdfTableHeader(cells))continue;

      const dateText=cells[1]||"";
      const date=parseDate(dateText);

      if(date){
        active={
          "Aula nº":"",
          "Data":"",
          "Conteúdo":"",
          "Estratégias de ensino":"",
          "Avaliação":"",
          "Bibliografia":""
        };
        rows.push(active);
      }

      if(!active)continue;

      if(!date&&pdfAdministrativeLine(full))continue;

      appendPdfCell(active,"Aula nº",cells[0]);
      appendPdfCell(active,"Data",cells[1]);
      appendPdfCell(active,"Conteúdo",cells[2]);
      appendPdfCell(active,"Estratégias de ensino",cells[3]);
      appendPdfCell(active,"Avaliação",cells[4]);
      appendPdfCell(active,"Bibliografia",cells[5]);
    }
  }

  return rows.filter(r=>parseDate(r["Data"])&&String(r["Conteúdo"]||"").trim());
}
function scorePdfRows(rows){
  // Prefere quantidade de registros, mas também valoriza separação das colunas.
  return rows.reduce((score,r)=>{
    score+=10;
    if(r["Aula nº"])score+=1;
    if(r["Estratégias de ensino"])score+=1;
    if(r["Avaliação"])score+=1;
    if(r["Bibliografia"])score+=1;
    return score;
  },0);
}
async function readPdfStructured(file){
  if(!window.pdfjsLib)throw new Error("Leitor PDF não carregado.");
  pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
  const pages=[];
  const rawText=[];
  let detectedGrid=null;

  for(let p=1;p<=pdf.numPages;p++){
    const page=await pdf.getPage(p);
    const viewport=page.getViewport({scale:1});
    const tc=await page.getTextContent();

    const items=tc.items
      .filter(i=>String(i.str||"").trim())
      .map(i=>({
        str:String(i.str||""),
        x:i.transform?.[4]||0,
        y:i.transform?.[5]||0,
        width:i.width||0
      }));

    const pageText=items.map(i=>i.str).join(" ");
    rawText.push(pageText);
    pages.push({page,items,width:viewport.width,height:viewport.height});

    if(!detectedGrid){
      try{
        detectedGrid=await detectPdfGridBoundaries(page);
      }catch(e){
        detectedGrid=null;
      }
    }
  }

  const allText=rawText.join("\n");
  const candidates=[];

  // Estratégia A: grade detectada visualmente.
  if(detectedGrid){
    const rows=parsePdfPagesWithGrid(pages,detectedGrid);
    candidates.push({
      rows,
      score:scorePdfRows(rows),
      source:detectedGrid.source||"rendered-grid"
    });
  }

  // Estratégia B: fallback canônico.
  // Não depende do canvas e funciona quando a extração textual do PDF está íntegra.
  if(pages.length&&pdfHasCanonicalSixColumnHeader(allText)){
    const canonical=canonicalFaresiPdfGrid(pages[0].width);
    const rows=parsePdfPagesWithGrid(pages,canonical);
    candidates.push({
      rows,
      score:scorePdfRows(rows),
      source:canonical.source
    });
  }

  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0];

  if(!best||!best.rows.length){
    throw new Error("A tabela foi encontrada no PDF, mas não consegui separar as aulas em células válidas.");
  }

  const meta=extractMetaFromText(allText);

  return{
    rows:best.rows,
    text:allText,
    ext:"pdf",
    meta,
    year:getAcademicYear(file.name),
    pdfSource:best.source,
    headers:["Aula nº","Data","Conteúdo","Estratégias de ensino","Avaliação","Bibliografia"]
  };
}
async function readFile(file){
  const ext=file.name.split(".").pop().toLowerCase();
  if(ext==="csv"||ext==="txt")return{text:await file.text(),rows:null,ext,meta:{},year:getAcademicYear(file.name)};
  if(["xlsx","xls"].includes(ext)&&window.XLSX){const wb=XLSX.read(await file.arrayBuffer(),{type:"array"}),sheet=wb.Sheets[wb.SheetNames[0]];return{rows:XLSX.utils.sheet_to_json(sheet,{defval:""}),text:XLSX.utils.sheet_to_csv(sheet),ext,meta:{},year:getAcademicYear(file.name)}}
  if(ext==="docx")return await readDocxStructured(file);
  if(ext==="pptx")return await readPptxStructured(file);
  if(ext==="pdf")return await readPdfStructured(file);
  throw new Error("Formato não suportado para leitura automática.");
}
function normalizeHeader(s){
  const raw=String(s??"").trim();
  if(raw==="#")return"n";
  return raw.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
}
const aliases={
  lesson:["aulano","aulan","numeroaula","numerodaaula","aula","n"],
  date:["data","date"],
  content:["conteudo","assunto","tema","temaconteudo","temaconteudosequencia","content"],
  strategy:["estrategiasdeensino","estrategia","metodologia","metodo","strategy"],
  assessment:["avaliacao","atividadeavaliativa","atividade","atividadetarefa","tarefa","assessment"],
  bibliography:["bibliografia","referencias","referencia","referenciaabnt","referenciabibliografica","bibliography"],
  points:["pontos","pontuacao","nota","valor"],
  type:["tipo","type"]
};
function findColumn(row,keys){return Object.keys(row).find(k=>keys.includes(normalizeHeader(k)))}
function cleanCell(v,{preserveLines=false}={}){let x=String(v??"").replace(/\u00a0/g," ").replace(/\r/g,"");if(preserveLines)return x.split("\n").map(t=>t.replace(/\s+/g," ").trim()).filter(Boolean).join("\n");return x.replace(/\s*\n\s*/g," ").replace(/\s{2,}/g," ").trim()}
function parseDate(v,fallbackYear=getAcademicYear()){
  if(!v)return"";
  if(v instanceof Date&&!isNaN(v))return v.toISOString().slice(0,10);
  if(typeof v==="number"&&window.XLSX){
    const d=XLSX.SSF.parse_date_code(v);
    if(d)return`${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`;
  }
  const s=String(v).replace(/\u00a0/g," ").trim();
  let m=s.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})/);
  if(m)return`${m[3]}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;
  m=s.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2})(?!\d)/);
  if(m){
    const yy=Number(m[3]);
    const yyyy=yy<=79?2000+yy:1900+yy;
    return`${yyyy}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;
  }
  m=s.match(/(\d{1,2})[\/.-](\d{1,2})(?![\/.\d-])/);
  if(m)return`${fallbackYear}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;
  m=s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  return m?`${m[1]}-${m[2]}-${m[3]}`:"";
}

function validIsoDateParts(y,m,d){
  const dt=new Date(Number(y),Number(m)-1,Number(d),12,0,0,0);
  return dt.getFullYear()===Number(y)&&dt.getMonth()===Number(m)-1&&dt.getDate()===Number(d);
}
function makeIsoDate(y,m,d){
  if(!validIsoDateParts(y,m,d))return"";
  return `${Number(y)}-${String(Number(m)).padStart(2,"0")}-${String(Number(d)).padStart(2,"0")}`;
}
function parseCalendarDates(value,fallbackYear=getAcademicYear()){
  const raw=String(value??"").replace(/\u00a0/g," ").trim();
  const dates=[];

  const push=(y,m,d)=>{
    let year=Number(y);
    if(year<100)year=year<=79?2000+year:1900+year;
    const iso=makeIsoDate(year,m,d);
    if(iso&&!dates.includes(iso))dates.push(iso);
  };

  if(!raw)return dates;

  // Datas completas isoladas: 07/08/26, 07-08-2026, etc.
  for(const m of raw.matchAll(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/g)){
    push(m[3],m[2],m[1]);
  }

  // Intervalo/lista compartilhando mês/ano: "15 e 16/12/26", "15, 16 e 17/12/2026".
  for(const m of raw.matchAll(/((?:\d{1,2}\s*(?:,|e|\/)\s*)+\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{2,4})/gi)){
    const days=[...m[1].matchAll(/\d{1,2}/g)].map(x=>Number(x[0]));
    for(const d of days)push(m[3],m[2],d);
  }

  // Duas datas onde a primeira omite o ano: "15/12 e 16/12/26".
  for(const m of raw.matchAll(/(\d{1,2})[\/.-](\d{1,2})\s*(?:e|,|\/)\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/gi)){
    push(m[5],m[2],m[1]);
    push(m[5],m[4],m[3]);
  }

  // Data sem ano.
  if(!dates.length){
    for(const m of raw.matchAll(/(\d{1,2})[\/.-](\d{1,2})(?![\/.\d-])/g)){
      push(fallbackYear,m[2],m[1]);
    }
  }

  // Último fallback: comportamento já usado no sistema.
  if(!dates.length){
    const one=parseDate(raw,fallbackYear);
    if(one)dates.push(one);
  }

  return dates.sort();
}
function calendarDatesForItem(item){
  const source=item?.source_date_text||item?.date_text||item?.original_date||"";
  const fromSource=parseCalendarDates(source);
  const dates=[...(Array.isArray(item?.calendar_dates)?item.calendar_dates:[]),...fromSource];
  if(item?.event_date)dates.push(item.event_date);
  return [...new Set(dates.filter(x=>dateFromIso(x)))].sort();
}
function calendarItemsForDate(iso){
  return sortAgenda(validAgendaItems().filter(item=>calendarDatesForItem(item).includes(iso)));
}
function inferType(text){const s=String(text||"").toLowerCase();if(/prova|avalia[cç][aã]o\s+(da|de|i|ii|final)|\bav[12]\b|segunda chamada|ii chamada/.test(s))return"prova";if(/semin[aá]rio/.test(s))return"seminario";if(/evento|feriado|reposi[cç][aã]o/.test(s))return"evento";if(/atividade|trabalho|valendo\s*\d|pontos?/.test(s))return"atividade";return"aula"}
function inferPoints(text){const m=String(text||"").match(/(?:valendo|valor|nota|peso)?\s*(\d+(?:[.,]\d+)?)\s*(?:pontos?|pts?)/i);return m?Number(m[1].replace(",",".")):null}
function semanticHeaderKind(value){
  const raw=String(value??"").trim();
  const h=normalizeHeader(raw);
  if(raw==="#"||aliases.lesson.includes(h)||/(^|numero)(aula|encontro)$/.test(h)||/^(encontro|semana|ordem)$/.test(h))return"lesson";
  if(aliases.date.includes(h)||/^(dia|datadaaula|dataaula|dataencontro|datadoencontro|prazo|dataprevista)$/.test(h))return"date";
  if(aliases.content.includes(h)||/(conteudo|assunto|tema|tematica|topico|unidade|programa|ementa|objetivo)/.test(h))return"content";
  if(aliases.strategy.includes(h)||/(estrateg|metodolog|procediment|recurs|dinamica|abordagem|tecnicadeensino|encaminhamento)/.test(h))return"strategy";
  if(aliases.assessment.includes(h)||/(avalia|atividade|tarefa|entrega|instrumento|criterio|produto|trabalho)/.test(h))return"assessment";
  if(aliases.bibliography.includes(h)||/(bibliograf|referenc|leitura|materialdeapoio|fontes|literatura)/.test(h))return"bibliography";
  if(aliases.points.includes(h)||/(ponto|pontuacao|nota|peso|valor)/.test(h))return"points";
  if(aliases.type.includes(h)||/(tipo|modalidade|natureza|categoria|formato)/.test(h))return"type";
  return"unknown";
}
function semanticMapForRow(row){
  const map={};
  for(const key of Object.keys(row||{})){
    const kind=semanticHeaderKind(key);
    if(kind!=="unknown"&&!map[kind])map[kind]=key;
  }
  return map;
}
function inferGenericColumnMap(rows,year=getAcademicYear()){
  if(!rows?.length)return{};
  const keys=[...new Set(rows.flatMap(r=>Object.keys(r||{})))];
  const stats=keys.map(key=>{
    const vals=rows.slice(0,30).map(r=>cleanCell(r[key])).filter(Boolean);
    const dateHits=vals.filter(v=>parseDate(v,year)).length;
    const numericHits=vals.filter(v=>/^\d{1,3}(?:\s*[,;/\-]\s*\d{1,3})*$/.test(v)).length;
    const avgLen=vals.length?vals.reduce((a,v)=>a+v.length,0)/vals.length:0;
    const longHits=vals.filter(v=>v.length>35).length;
    return{key,vals:vals.length,dateHits,numericHits,avgLen,longHits};
  });
  const result={};
  const byDate=[...stats].sort((a,b)=>b.dateHits-a.dateHits);
  if(byDate[0]?.dateHits>=Math.max(2,Math.ceil(byDate[0].vals*.45)))result.date=byDate[0].key;

  const byLesson=stats.filter(s=>s.key!==result.date).sort((a,b)=>(b.numericHits/(b.vals||1))-(a.numericHits/(a.vals||1)));
  if(byLesson[0]?.numericHits>=2)result.lesson=byLesson[0].key;

  const textCols=stats.filter(s=>![result.date,result.lesson].includes(s.key)&&s.avgLen>4).sort((a,b)=>b.avgLen-a.avgLen);
  if(textCols[0])result.content=textCols[0].key;
  if(textCols[1])result.bibliography=textCols[1].key;
  return result;
}
function mergeAdaptiveMaps(primary,fallback){
  return {...fallback,...primary};
}
function canonicalizeStructuredRows(rows,year=getAcademicYear()){
  if(!Array.isArray(rows)||!rows.length)return[];
  const generic=inferGenericColumnMap(rows,year);
  const out=[];
  let last=null;

  for(const row of rows){
    const map=mergeAdaptiveMaps(semanticMapForRow(row),generic);
    const canonical={
      lesson:cleanCell(map.lesson?row[map.lesson]:"",{preserveLines:true}),
      dateRaw:cleanCell(map.date?row[map.date]:"",{preserveLines:true}),
      content:cleanCell(map.content?row[map.content]:"",{preserveLines:true}),
      strategy:cleanCell(map.strategy?row[map.strategy]:"",{preserveLines:true}),
      assessment:cleanCell(map.assessment?row[map.assessment]:"",{preserveLines:true}),
      bibliography:cleanCell(map.bibliography?row[map.bibliography]:"",{preserveLines:true}),
      pointsRaw:cleanCell(map.points?row[map.points]:""),
      sourceType:cleanCell(map.type?row[map.type]:"",{preserveLines:true}),
      sourceMap:map
    };
    const date=parseDate(canonical.dateRaw,year);
    const joined=[canonical.lesson,canonical.dateRaw,canonical.content,canonical.strategy,canonical.assessment,canonical.bibliography,canonical.sourceType].filter(Boolean).join(" ");
    const admin=/^(orientacao|extensao|orientacao extensao|intervalo)$/i.test(joined.normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim());

    if(admin)continue;

    if(date){
      canonical.date=date;
      out.push(canonical);
      last=canonical;
      continue;
    }

    // Continuação textual sem data: anexa à célula anterior mantendo o campo original.
    if(last){
      for(const field of ["content","strategy","assessment","bibliography"]){
        const val=canonical[field];
        if(!val)continue;
        if(!last[field])last[field]=val;
        else if(last[field]!==val&&!last[field].endsWith("\n"+val))last[field]+="\n"+val;
      }
      if(!last.sourceType&&canonical.sourceType)last.sourceType=canonical.sourceType;
    }
  }
  return out;
}
function itemConfidence(item){
  let score=0;
  if(item.event_date)score+=35;
  if(item.content&&item.content.length>=3)score+=30;
  if(item.lesson_number)score+=8;
  if(item.teaching_strategy)score+=8;
  if(item.assessment)score+=8;
  if(item.bibliography)score+=8;
  if(item.source_type)score+=3;
  return Math.min(100,score);
}
function parseStructuredRows(rows,subjectId,year=getAcademicYear()){
  const canonicalRows=canonicalizeStructuredRows(rows,year);
  const out=[];let ignored=0,invalid=0;const problems=[];

  for(let idx=0;idx<canonicalRows.length;idx++){
    const r=canonicalRows[idx];
    const date=r.date||parseDate(r.dateRaw,year);
    let content=r.content;

    // Alguns calendários usam a coluna de avaliação/tipo como conteúdo do dia.
    // Só usa fallback quando a coluna de conteúdo realmente está vazia.
    if(!content)content=r.assessment||r.strategy||r.sourceType||"";

    if(!date){ignored++;problems.push(`Registro ${idx+1}: sem data válida`);continue}
    if(!content){invalid++;problems.push(`Registro ${idx+1}: sem conteúdo identificável`);continue}

    const combined=`${r.sourceType} ${content} ${r.strategy} ${r.assessment}`;
    const rawPoints=r.pointsRaw||"";
    const item={
      id:uid("i"),
      subject_id:subjectId,
      lesson_number:r.lesson,
      event_date:date,
      source_date_text:r.dateRaw||"",
      calendar_dates:parseCalendarDates(r.dateRaw||date,year),
      content,
      teaching_strategy:r.strategy,
      assessment:r.assessment,
      bibliography:r.bibliography,
      source_type:r.sourceType,
      type:inferType(combined),
      points:rawPoints!==""&&!Number.isNaN(Number(rawPoints.replace(",",".")))?Number(rawPoints.replace(",",".")):inferPoints(combined),
      manually_edited:false,
      completed:false,
      source_row:r.lesson,
      source_schema:"adaptive"
    };
    item.import_confidence=itemConfidence(item);
    out.push(item);
  }

  const confidence=out.length?Math.round(out.reduce((a,x)=>a+x.import_confidence,0)/out.length):0;
  out.ignoredRows=ignored;
  out.invalidRows=invalid;
  out.problems=problems;
  out.completeRows=out.filter(x=>x.import_confidence>=80).length;
  out.reviewRows=out.filter(x=>x.import_confidence<80).length;
  out.confidenceAverage=confidence;
  return out;
}
function scoreScheduleCandidate(items){
  if(!items?.length)return-9999;
  const uniqueDates=new Set(items.map(x=>x.event_date)).size;
  const avg=items.reduce((a,x)=>a+(x.import_confidence||itemConfidence(x)),0)/items.length;
  const rich=items.filter(x=>x.teaching_strategy||x.assessment||x.bibliography).length;
  return items.length*30+uniqueDates*5+avg+rich*3-(items.invalidRows||0)*4;
}
function parseTextByDatesFlexible(text,subjectId,year=getAcademicYear()){
  const source=String(text||"").replace(/\u00a0/g," ").replace(/\r/g," ");
  const re=/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/g;
  const matches=[...source.matchAll(re)].filter(m=>{
    const before=source.slice(Math.max(0,m.index-18),m.index).toLowerCase();
    return !/(isbn|doi|p\.|v\.|n\.)\s*$/.test(before);
  });
  const out=[];
  for(let i=0;i<matches.length;i++){
    const m=matches[i];
    const y=m[3]?Number(m[3].length===2?(Number(m[3])<=79?`20${m[3]}`:`19${m[3]}`):m[3]):year;
    if(y<1990||y>2100)continue;
    const date=`${y}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;
    const end=i+1<matches.length?matches[i+1].index:source.length;
    let block=source.slice(m.index+m[0].length,end).replace(/\s+/g," ").trim();
    if(!block)continue;
    if(block.length>1000)block=block.slice(0,1000);
    const lessonMatch=source.slice(Math.max(0,m.index-12),m.index).match(/(\d{1,3})\s*$/);
    let content=block;
    const bibPos=block.search(/\b(?:REFER[ÊE]NCIAS?|BIBLIOGRAFIA|[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{3,},\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/i);
    const bibliography=bibPos>=0?block.slice(bibPos).trim():"";
    if(bibPos>=0)content=block.slice(0,bibPos).trim();
    if(content.length>320)content=content.slice(0,320).trim();
    if(!content)continue;
    const item={
      id:uid("i"),subject_id:subjectId,lesson_number:lessonMatch?.[1]||"",
      event_date:date,source_date_text:m[0]||date,calendar_dates:parseCalendarDates(m[0]||date,year),content,teaching_strategy:"",assessment:"",
      bibliography,type:inferType(content),points:inferPoints(content),
      manually_edited:false,completed:false,source_schema:"text-adaptive"
    };
    item.import_confidence=Math.min(72,itemConfidence(item));
    out.push(item);
  }
  const deduped=dedupeItems(out);
  deduped.completeRows=deduped.filter(x=>(x.import_confidence||0)>=80).length;
  deduped.reviewRows=deduped.length-deduped.completeRows;
  deduped.confidenceAverage=deduped.length?Math.round(deduped.reduce((a,x)=>a+(x.import_confidence||0),0)/deduped.length):0;
  return deduped;
}
function interpretAcademicSchedule(read,subjectId,file){
  const candidates=[];

  if(read.rows?.length){
    const structured=parseStructuredRows(read.rows,subjectId,read.year);
    if(structured.length)candidates.push({items:structured,source:"structured-adaptive",score:scoreScheduleCandidate(structured)});
  }

  if(read.text){
    const textParsed=parseTextByDatesFlexible(read.text,subjectId,read.year||getAcademicYear(file?.name||""));
    if(textParsed.length)candidates.push({items:textParsed,source:"text-adaptive",score:scoreScheduleCandidate(textParsed)-40});
  }

  // Compatibilidade: mantém o parser antigo como uma terceira alternativa.
  if(!read.rows&&read.text){
    try{
      const legacy=parseTextByDates(read.text,subjectId);
      legacy.forEach(x=>{x.import_confidence=x.import_confidence||55});
      if(legacy.length)candidates.push({items:legacy,source:"legacy-text",score:scoreScheduleCandidate(legacy)-80});
    }catch(e){}
  }

  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0];
  if(!best)return[];

  const result=best.items;
  result.importSource=best.source;
  result.candidateCount=candidates.length;
  return result;
}
function splitDelimitedLine(line,sep){
  const out=[];let cur="",quoted=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){
      if(quoted&&line[i+1]==='"'){cur+='"';i++}
      else quoted=!quoted;
    }else if(ch===sep&&!quoted){out.push(cur.trim());cur=""}
    else cur+=ch;
  }
  out.push(cur.trim());
  return out;
}
function parseDelimitedText(text,subjectId){
  const lines=String(text||"").split(/\r?\n/).filter(x=>x.trim());
  if(!lines.length)return[];
  const candidates=[";","\t",","];
  const sep=candidates.sort((a,b)=>lines[0].split(b).length-lines[0].split(a).length)[0];
  if(sep){
    const headers=splitDelimitedLine(lines[0],sep);
    if(headers.length>1){
      const rows=lines.slice(1).map(line=>{
        const vals=splitDelimitedLine(line,sep);
        return Object.fromEntries(headers.map((h,i)=>[h,vals[i]??""]));
      });
      const parsed=parseStructuredRows(rows,subjectId);
      if(parsed.length)return parsed;
    }
  }
  return parseTextByDatesFlexible(text,subjectId);
}
function parseTextByDates(text,subjectId){const clean=String(text||"").replace(/\s+/g," ").trim();const matches=[...clean.matchAll(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/g)];const out=[];for(let i=0;i<matches.length;i++){const m=matches[i],start=m.index,end=i+1<matches.length?matches[i+1].index:clean.length;let block=clean.slice(start,end).trim();const date=`${m[3]}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;block=block.replace(m[0],"").trim();const lesson=(block.match(/\b(\d{1,2}(?:\s*[-–]\s*\d{1,2}){1,3})\b/)||[])[1]||"";const assessmentWords=/(atividade[^.]{0,140}|avalia[cç][aã]o[^.]{0,140}|prova[^.]{0,140})/i;const assess=(block.match(assessmentWords)||[])[1]||"";const bibStart=block.search(/\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{3,},\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/);const bibliography=bibStart>=0?block.slice(bibStart).trim():"";let contentPart=bibStart>=0?block.slice(0,bibStart):block;contentPart=contentPart.replace(lesson,"").trim();let content=contentPart.split(/(?=Os alunos|O professor|Será baseada|Cada aluno|Durante a aula)/i)[0].trim();if(content.length>220)content=content.slice(0,220).trim();if(!content)content="Evento acadêmico";out.push({id:uid("i"),subject_id:subjectId,lesson_number:lesson,event_date:date,content,teaching_strategy:"",assessment:assess,bibliography,type:inferType(`${content} ${assess}`),points:inferPoints(`${content} ${assess}`),manually_edited:false})}return dedupeItems(out)}
function dedupeItems(items){const seen=new Set();return items.filter(x=>{const k=x.event_date+"|"+x.content.toLowerCase().slice(0,60);if(seen.has(k))return false;seen.add(k);return true})}
async function analyzeFile(){
  const file=$("scheduleFile").files[0];
  if(!file)return toast("Selecione um arquivo.");
  $("analyzeFile").disabled=true;
  $("analyzeFile").textContent="Interpretando cronograma…";
  let subjectId,createdSubject=null;

  try{
    const read=await readFile(file);

    if($("importMode").value==="new"||!data.subjects.length){
      const detected=read.meta?.subjectName||"";
      const name=$("newImportSubjectName").value.trim()||detected||guessSubjectName(file.name)||"Nova disciplina";
      createdSubject={id:uid("s"),name,teacher:"",workload:read.meta?.workload||"",color:"#6557DF"};
      data.subjects.push(createdSubject);
      subjectId=createdSubject.id;
    }else subjectId=$("importSubject").value;

    const parsed=interpretAcademicSchedule(read,subjectId,file);
    normalizeImportedAcademicYear(parsed);

    if(!parsed.length){
      if(createdSubject)data.subjects=data.subjects.filter(s=>s.id!==createdSubject.id);
      const hdr=read.headers?.length?` Cabeçalhos encontrados: ${read.headers.map(escapeHtml).join(" • ")}.`:"";
      showImportResult("warning",`O arquivo foi aberto, mas o sistema não encontrou registros acadêmicos confiáveis.${hdr} Nenhum cronograma foi alterado.`);
      return;
    }

    data.files.push({id:uid("f"),name:file.name,type:file.name.split(".").pop().toUpperCase(),subject_id:subjectId});
    const existing=data.items.filter(x=>x.subject_id===subjectId);
    showImportPreview(parsed,existing,file,subjectId,createdSubject,read);
  }catch(e){
    if(createdSubject)data.subjects=data.subjects.filter(s=>s.id!==createdSubject.id);
    showImportResult("warning",`Não foi possível interpretar o arquivo: ${escapeHtml(e.message||String(e))}`);
  }finally{
    $("analyzeFile").disabled=false;
    $("analyzeFile").textContent="Ler e organizar arquivo";
  }
}
function formatPreviewDate(iso){if(!iso)return"—";const [y,m,d]=iso.split("-");return`${d}/${m}/${y}`}
function previewCell(value,kind=""){const txt=String(value||"").trim();return`<td class="${kind}">${txt?escapeHtml(txt).replace(/\n/g,"<br>"):'<span class="preview-empty">—</span>'}</td>`}
function showImportPreview(parsed,existing,file,subjectId,createdSubject,read={}){
  const withBib=parsed.filter(x=>x.bibliography).length;
  const assess=parsed.filter(x=>["atividade","prova"].includes(x.type)).length;
  const avg=parsed.confidenceAverage??Math.round(parsed.reduce((a,x)=>a+(x.import_confidence||itemConfidence(x)),0)/parsed.length);
  const complete=parsed.completeRows??parsed.filter(x=>(x.import_confidence||itemConfidence(x))>=80).length;
  const review=parsed.reviewRows??Math.max(0,parsed.length-complete);

  const previewRows=parsed.slice(0,15).map(x=>{
    const conf=x.import_confidence||itemConfidence(x);
    return `<tr class="${conf<80?"needs-review":""}">${previewCell(x.lesson_number,"lesson")}${previewCell(formatPreviewDate(x.event_date),"date")}${previewCell(x.content,"content")}${previewCell(x.teaching_strategy,"strategy")}${previewCell(x.assessment,"assessment")}${previewCell(x.bibliography,"bibliography")}</tr>`;
  }).join("");

  $("importResult").className="import-result success strict-preview";
  $("importResult").innerHTML=`
    <div class="preview-summary">
      <b>${parsed.length} células acadêmicas identificadas</b>
      <div class="small">${complete} completas • ${review} para revisão • ${withBib} com bibliografia • confiança média ${avg}%</div>
    </div>
    <div class="import-intelligence">
      <b>Leitura adaptativa</b>
      <span>O sistema identificou a estrutura do arquivo, associou semanticamente as colunas e reuniu continuações de uma mesma aula antes de criar as células.</span>
    </div>
    <div class="structure-lock"><b>Validação:</b> nenhuma célula é salva antes da confirmação. Linhas com menor confiança aparecem destacadas na prévia para conferência.</div>
    <div class="preview-table-wrap">
      <table class="preview-table">
        <thead><tr><th>Aula nº</th><th>Data</th><th>Conteúdo</th><th>Estratégias de ensino</th><th>Avaliação</th><th>Bibliografia</th></tr></thead>
        <tbody>${previewRows}</tbody>
      </table>
    </div>
    ${parsed.length>15?`<div class="small" style="margin:8px 14px 0">Prévia mostrando 15 de ${parsed.length} células.</div>`:""}
    <p class="preview-confirm-text">${review?`Existem ${review} célula(s) com menos informações que o padrão ideal. Confira principalmente essas linhas antes de confirmar.`:(existing.length?`Esta disciplina já possui ${existing.length} células. Confira a prévia antes de substituir.`:"A estrutura foi validada. Confira a prévia antes de adicionar.")}</p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin:10px 14px 14px">
      <button class="ghost" id="cancelPreview">Voltar sem aplicar</button>
      <button class="primary" id="applyImport">${existing.length?"Confirmar substituição":"Confirmar e adicionar cronograma"}</button>
    </div>`;

  $("cancelPreview").onclick=()=>toast("Nenhuma alteração aplicada.");
  $("applyImport").onclick=()=>{
    const apply=()=>{
      data.items=data.items.filter(x=>x.subject_id!==subjectId);
      parsed.forEach(x=>{
        if(typeof x.completed!=="boolean")x.completed=false;
        if(x.event_date&&!/^\d{4}-\d{2}-\d{2}$/.test(String(x.event_date))){
          const fixed=parseDate(x.event_date,read.year||getAcademicYear(file.name));
          if(fixed)x.event_date=fixed;
        }
      });
      normalizeImportedAcademicYear(parsed);
      data.items.push(...parsed);
      save();
      showImportSuccess(subjectId,parsed.length);
    };
    if(existing.length)confirmAction("Substituir cronograma?",`O cronograma atual possui ${existing.length} células e será substituído pelas ${parsed.length} células já conferidas na prévia.`,apply,"Sim, substituir");
    else apply();
  };
}
function profileAcademicYear(){
  const m=String(data.profile?.academic_period||"").match(/\b(20\d{2})\b/);
  return m?Number(m[1]):null;
}
function normalizeImportedAcademicYear(items){
  const expected=profileAcademicYear();
  if(!expected)return items;
  items.forEach(item=>{
    const m=String(item.event_date||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m)return;
    const parsedYear=Number(m[1]);
    // Corrige apenas anos claramente incompatíveis com o período do aluno.
    // Isso evita que anos de bibliografia (ex.: 2014) contaminem datas DD/MM.
    if(Math.abs(parsedYear-expected)>1){
      item.event_date=`${expected}-${m[2]}-${m[3]}`;
    }
  });
  return items;
}
function showImportSuccess(subjectId,count){
  lastImportedSubjectId=subjectId;
  const s=subject(subjectId);
  $("importSuccessMessage").textContent=`${count} célula${count!==1?"s":""} ${count!==1?"foram importadas":"foi importada"} corretamente para ${s?.name||"a disciplina"}.`;
  closeModals();
  render();
  openModal("importSuccessModal");
}
function showImportResult(kind,html){$("importResult").className=`import-result ${kind}`;$("importResult").innerHTML=html}
function openProfile(){$("profileName").value=data.profile.full_name;$("profileInstitution").value=data.profile.institution;$("profileCourse").value=data.profile.course;$("profileSemester").value=data.profile.semester;$("profilePeriod").value=data.profile.academic_period;openModal("profileModal")}function saveProfile(){data.profile={full_name:$("profileName").value.trim(),institution:$("profileInstitution").value.trim(),course:$("profileCourse").value.trim(),semester:$("profileSemester").value.trim(),academic_period:$("profilePeriod").value.trim()};save();closeModals();render();toast("Perfil atualizado.")}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c])}function escapeAttr(s){return escapeHtml(s).replace(/`/g,"&#96;")}
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=closeModals);$("modalBackdrop").onclick=closeModals;$("openImportedSubject").onclick=()=>{if(lastImportedSubjectId){selectedSubject=lastImportedSubjectId;view="disciplina";closeModals();render()}};$("saveAndImportSubject").onclick=createSubjectAndImport;
$("subjectScheduleFile").onchange=e=>{
  const f=e.target.files[0];
  $("subjectSelectedFileName").textContent=f?f.name:"Selecionar cronograma";
  if(f&&!$("subjectName").value.trim()){
    const guessed=guessSubjectName(f.name);
    if(guessed)$("subjectName").value=guessed;
  }
};$("saveSubject").onclick=saveSubject;$("saveItem").onclick=saveItem;$("deleteItem").onclick=()=>{const id=$("itemId").value;if(id){closeModals();requestDeleteItem(id)}};$("saveProfile").onclick=saveProfile;$("analyzeFile").onclick=analyzeFile;$("importMode").onchange=syncImportMode;$("scheduleFile").onchange=e=>{const f=e.target.files[0];$("selectedFileName").textContent=f?f.name:"Selecione o arquivo do cronograma";if(f&&!$("newImportSubjectName").value)$("newImportSubjectName").value=guessSubjectName(f.name)};$("confirmAction").onclick=()=>{const fn=pendingConfirm;closeModals();if(fn)fn()};

// A aplicação só é liberada depois que o Supabase confirmar uma sessão válida.
bindAuthenticationUI();
initializeAuth().catch(err=>{
  console.error("Falha ao inicializar autenticação:",err);
  showAuth();
  setAuthMessage("loginMessage","Não foi possível validar a sessão. Verifique a configuração do Supabase e tente novamente.","error");
});

if(window.matchMedia){
  const mq=window.matchMedia("(prefers-color-scheme: dark)");
  const updateThemeFromSystem=()=>{if((data.preferences?.theme||"light")==="system")applyTheme()};
  if(mq.addEventListener)mq.addEventListener("change",updateThemeFromSystem);
}

function fallbackImportClick(e){
  const update=e.target.closest("[data-update-subject]");
  if(update){
    e.preventDefault();
    e.stopPropagation();
    openImport(update.dataset.updateSubject||"");
    return;
  }
  const generic=e.target.closest("[data-import]");
  if(generic){
    e.preventDefault();
    e.stopPropagation();
    openImport();
  }
}
document.addEventListener("click",fallbackImportClick);


function fallbackSubjectClick(e){
  const actionButton=e.target.closest("button,[data-edit-subject],[data-delete-subject],[data-update-subject]");
  if(actionButton)return;

  const card=e.target.closest("[data-subject]");
  if(!card)return;

  const id=card.dataset.subject;
  if(!id||!subject(id))return;

  e.preventDefault();
  selectedSubject=id;
  view="disciplina";
  render();
}
document.addEventListener("click",fallbackSubjectClick);


document.addEventListener("keydown",e=>{
  const card=e.target.closest?.("[data-subject]");
  if(!card)return;
  if(e.key!=="Enter"&&e.key!==" ")return;
  if(e.target.closest("button,[data-edit-subject],[data-delete-subject],[data-update-subject]"))return;
  e.preventDefault();
  const id=card.dataset.subject;
  if(id&&subject(id)){
    selectedSubject=id;
    view="disciplina";
    render();
  }
});

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  });
}
