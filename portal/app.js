(() => {
  'use strict';
  const cfg = window.SEALT_CONFIG || {};
  const app = document.getElementById('app');
  const state = { session: null, profile: null, view: 'home', items: [], users: [], current: null, busy: false, message: '', pendingRecord: null };
  const configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const clean = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = d => d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR') : '—';
  const stamp = d => d ? new Date(d).toLocaleString('pt-BR') : '—';
  const money = n => Number(n || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const label = s => ({draft:'Rascunho',pending:'Pendente',approved:'Aprovado',rejected:'Reprovado'})[s] || s;
  const roleName = r => ({requester:'Solicitante',approver:'Aprovador',finance:'Financeiro',admin:'Administrador'})[r] || r;
  const icon = name => ({home:'<path d="M3 10 12 3l9 7v11H3z"/><path d="M9 21v-7h6v7"/>',works:'<path d="M4 21h16M6 21V8l6-5 6 5v13M9 11h6M9 15h6"/>',wallet:'<rect x="3" y="6" width="18" height="15" rx="2"/><path d="M3 10h18M16 15h2"/>',check:'<path d="m4 12 5 5L20 6"/>',users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 6a3 3 0 0 1 0 6M17 16a5 5 0 0 1 4 5"/>'})[name];
  const svg = name => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon(name)}</svg>`;
  function alertBox(){ if(!state.message) return ''; const m=state.message; return `<div class="notice ${m.kind || ''}" role="status">${clean(m.text)}</div>`; }
  function flash(text,kind='error'){state.message={text,kind}; render(); window.scrollTo({top:0,behavior:'smooth'});}
  function inlineNotice(form,text){const old=form.querySelector('.form-notice');if(old)old.remove();const box=document.createElement('div');box.className='notice error form-notice';box.setAttribute('role','alert');box.textContent=text;form.prepend(box);box.scrollIntoView({behavior:'smooth',block:'center'});}
  function url(path){return cfg.supabaseUrl.replace(/\/$/,'')+path;}
  async function request(path,{method='GET',body,auth=true,headers={}}={}){
    const h={apikey:cfg.supabaseAnonKey,...headers};
    if(auth && state.session?.access_token) h.Authorization=`Bearer ${state.session.access_token}`;
    if(body !== undefined && !(body instanceof Blob)) h['Content-Type']='application/json';
    let response;
    try { response=await fetch(url(path),{method,headers:h,body:body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body)}); }
    catch {throw new Error('Sem conexão com o servidor. Tente novamente.');}
    let data=null;
    const raw=await response.text();try{data=raw?JSON.parse(raw):null;}catch{data=raw;}
    if(!response.ok){ const msg=data?.message || data?.error_description || data?.error || data?.hint || `Erro ${response.status}`; throw new Error(msg); }
    return data;
  }
  async function rest(table,query='',options={}){
    return request(`/rest/v1/${table}${query}`,{...options,headers:{...(options.headers || {}),Prefer: options.method === 'POST' ? 'return=representation' : 'return=minimal'}});
  }
  async function rpc(name,payload){return request(`/rest/v1/rpc/${name}`,{method:'POST',body:payload});}
  function storeSession(session){state.session=session; if(session) sessionStorage.setItem('sealt_session',JSON.stringify(session));else sessionStorage.removeItem('sealt_session');}
  async function refresh(){
    if(!state.session?.refresh_token) return false;
    try{const fresh=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',auth:false,body:{refresh_token:state.session.refresh_token}});storeSession(fresh);return true;}
    catch{storeSession(null);return false;}
  }
  async function guarded(work){
    try{return await work();}catch(e){
      if(/JWT expired|invalid JWT|session_not_found/i.test(e.message) && await refresh())return work();
      throw e;
    }
  }
  function authScreen(mode='login'){
    const sign=mode==='signup';
    app.innerHTML=`<div class="auth"><div class="auth-art"><div class="brand">SEALT<small>CONSTRUTORA</small></div><div><h1>Um lugar para acompanhar a obra e o financeiro.</h1><p>Relatórios diários e protocolos em um único acesso para sua equipe.</p></div><small>Portal interno</small></div><main class="authbox"><div class="panel"><h2>${sign?'Criar acesso':'Entrar no portal'}</h2><p>${sign?'Cadastre seu e-mail de trabalho. Um administrador libera o seu perfil.':'Acesse com seu e-mail e senha.'}</p>${alertBox()}<form id="auth-form">${sign?'<div class="field"><label for="name">Nome completo</label><input id="name" name="name" required autocomplete="name"></div>':''}<div class="field"><label for="email">E-mail</label><input id="email" name="email" type="email" required autocomplete="email"></div><div class="field"><label for="password">Senha</label><input id="password" name="password" type="password" minlength="6" required autocomplete="${sign?'new-password':'current-password'}"></div><button class="btn" type="submit">${sign?'Criar conta':'Entrar'}</button></form><button class="swap" data-action="${sign?'login':'signup'}">${sign?'Já tenho conta':'Criar conta'}</button></div></main></div>`;
    app.querySelector('#auth-form').addEventListener('submit',async ev=>{
      ev.preventDefault();const f=new FormData(ev.target);const email=String(f.get('email')).trim();const password=String(f.get('password'));
      const endpoint=sign?'/auth/v1/signup':'/auth/v1/token?grant_type=password';
      try{const session=await request(endpoint,{method:'POST',auth:false,body:sign?{email,password,data:{full_name:String(f.get('name')).trim()}}:{email,password}});
        if(!session.access_token){flash('Cadastro enviado. Confirme seu e-mail e depois entre.','success');return;}
        storeSession(session);state.message='';await loadProfile();state.view='home';render();
      }catch(e){flash(e.message);}
    });
  }
  function shell(content,title,section){
    const r=state.profile?.role;
    const nav=[['home','Início','home'],...(state.profile.can_obras?[['works','Obras','works']]:[]),...(state.profile.can_financeiro?[['finance','Financeiro','wallet']]:[]),...(state.profile.can_financeiro&&(r==='approver'||r==='admin')?[['approvals','Aprovações','check']]:[]),...(r==='admin'?[['users','Usuários','users']]:[])];
    app.innerHTML=`<div class="shell"><aside class="sidebar"><div class="brand">SEALT<small>CONSTRUTORA</small></div><div class="mobilebrand">SEALT</div><nav class="nav" aria-label="Módulos">${nav.map(([id,name,ico])=>`<button data-view="${id}" class="${section===id?'active':''}">${svg(ico)} ${name}</button>`).join('')}</nav><div class="asidefoot"><strong>${clean(state.profile?.full_name || state.session?.user?.email || 'Usuário')}</strong>${clean(roleName(r))}<br><button data-action="logout">Sair da conta</button></div></aside><main class="main"><header class="topline"><div><div class="eyebrow">Portal de aplicativos</div><h1>${clean(title)}</h1></div><div class="userpill">${clean(state.profile?.full_name || state.session?.user?.email || '')}</div></header>${alertBox()}${content}</main></div>`;
  }
  function home(){const cards=[state.profile.can_obras?`<div class="card"><div class="icon">${svg('works')}</div><h2>Obras</h2><p>Acesse o Relatório Diário de Obra.</p><button class="btn ghost" data-view="works">Abrir Obras →</button></div>`:'',state.profile.can_financeiro?`<div class="card"><div class="icon">${svg('wallet')}</div><h2>Financeiro</h2><p>Cadastre protocolos, acompanhe aprovações e exporte registros aprovados.</p><button class="btn ghost" data-view="finance">Abrir Financeiro →</button></div>`:''].join('');shell(cards?`<p class="intro">Selecione o módulo para trabalhar.</p><div class="cards">${cards}</div>`:'<div class="panel"><h2>Aguardando liberação</h2><p>Seu cadastro foi criado. Um administrador precisa liberar os módulos para sua conta.</p></div>','Visão geral','home');}
  function works(){if(!state.profile.can_obras){state.view='home';home();return;}shell(`<div class="card compact"><div class="icon">${svg('works')}</div><h2>Relatório Diário de Obra (RDO)</h2><p>O RDO atual continua disponível para criação e consulta dos relatórios.</p><a class="btn" href="${clean(cfg.rdoUrl)}" target="_blank" rel="noopener noreferrer" style="margin-top:24px">Abrir RDO atual ↗</a></div><div class="notice">O RDO mantém seu acesso e dados atuais nesta etapa. A integração com o login único depende do projeto e dos arquivos mais recentes do RDO.</div>`,'Obras','works');}
  function finance(){if(!state.profile.can_financeiro){state.view='home';home();return;}
    const canExport=['admin','finance'].includes(state.profile?.role);
    const rows=state.items.map(x=>`<tr><td><button data-open="${clean(x.id)}">${clean(x.display_name)}</button></td><td>${clean(x.name)}</td><td>${clean(x.document_no)}</td><td>${date(x.due_date)}</td><td>${money(x.amount)}</td><td><span class="status ${x.status==='pending'?'pendente':x.status==='approved'?'aprovado':x.status==='rejected'?'reprovado':'rascunho'}">${label(x.status)}</span></td></tr>`).join('');
    shell(`<div class="sectionbar"><div><h2>Protocolos</h2><div class="hint">${state.items.length} registro(s) disponível(is) para seu perfil</div></div><div class="actions"><button class="btn secondary" data-action="reload">Atualizar</button>${canExport?'<button class="btn secondary" data-action="export">Exportar aprovados</button>':''}<button class="btn" data-view="new">Novo protocolo</button></div></div><div class="panel tablewrap">${rows?`<table class="table"><thead><tr><th>Protocolo</th><th>Nome</th><th>Nº Docto/NF</th><th>Venc.</th><th>Valor</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`:'<div class="empty">Nenhum protocolo encontrado.</div>'}</div>`,'Financeiro','finance');
  }
  function newForm(){if(!state.profile.can_financeiro){state.view='home';home();return;}
    const approvers=state.users.filter(x=>x.active && ['approver','admin'].includes(x.role));
    shell(`<form class="panel compact" id="protocol-form"><div class="sectionbar" style="margin-top:0"><h2>Dados do protocolo</h2><button type="button" class="btn ghost" data-view="finance">Voltar</button></div><div class="grid"><div class="field"><label for="entity">Entidade *</label><input id="entity" name="entity" required></div><div class="field"><label for="cost_center">Centro de custo</label><input id="cost_center" name="cost_center"></div><div class="field"><label for="name">Nome / razão social *</label><input id="name" name="name" required></div><div class="field"><label for="document_no">Nº Docto/NF *</label><input id="document_no" name="document_no" required></div><div class="field"><label for="issue_date">Emissão *</label><input id="issue_date" name="issue_date" type="date" required></div><div class="field"><label for="due_date">Vencimento *</label><input id="due_date" name="due_date" type="date" required></div><div class="field"><label for="amount">Valor (R$) *</label><input id="amount" name="amount" type="number" step="0.01" required><small>A pagar: negativo. A receber: positivo.</small></div><div class="field"><label for="category">Categoria *</label><input id="category" name="category" required></div><div class="field"><label for="protocol_type">Tipo de protocolo</label><input id="protocol_type" name="protocol_type"></div><div class="field"><label for="approver_id">Enviar para aprovação *</label><select id="approver_id" name="approver_id" required><option value="">Selecione um usuário</option>${approvers.map(x=>`<option value="${clean(x.id)}">${clean(x.full_name || x.email)}</option>`).join('')}</select></div><div class="field span2"><label for="description">Descrição *</label><textarea id="description" name="description" required></textarea></div><div class="field span2"><label for="notes">Observação</label><textarea id="notes" name="notes"></textarea></div><div class="field span2"><label for="files">Documentos (PDF, JPG ou PNG) *</label><input id="files" name="files" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" multiple required><small>Até 10 MB por arquivo. NF, boleto e comprovantes ficam anexados ao protocolo.</small></div></div><button class="btn" type="submit">Protocolar e enviar ao aprovador</button></form>`,'Novo protocolo','finance');
    if(!approvers.length){app.querySelector('#protocol-form button[type=submit]').disabled=true;app.querySelector('#protocol-form').insertAdjacentHTML('afterbegin','<div class="notice error">Ainda não há aprovadores cadastrados. Um administrador precisa atribuir esse perfil a um usuário.</div>');}
    app.querySelector('#protocol-form').addEventListener('submit',submitProtocol);
  }
  function detail(){if(!state.profile.can_financeiro){state.view='home';home();return;}const x=state.current;if(!x){state.view='finance';finance();return;}
    const fields=[['Emissão',date(x.issue_date)],['Vencimento',date(x.due_date)],['Nº Docto/NF',x.document_no],['Nome / razão social',x.name],['Valor',money(x.amount)],['Entidade',x.entity],['Centro de custo',x.cost_center],['Categoria',x.category],['Tipo de protocolo',x.protocol_type],['Descrição',x.description],['Observação',x.notes],['Enviado em',stamp(x.submitted_at)]];
    const mine=x.status==='pending' && x.approver_id===state.profile.id;
    const docs=(x.protocol_documents||[]).map(d=>`<li><button class="btn ghost" data-document="${clean(d.path)}">${clean(d.filename)} ↗</button></li>`).join('');
    const events=(x.protocol_events||[]).map(e=>`<li><strong>${clean(label(e.action))}</strong> ${clean(e.note||'')}<small>${stamp(e.created_at)}</small></li>`).join('');
    shell(`<button class="btn ghost" data-view="finance">← Voltar aos protocolos</button><div class="sectionbar"><h2>${clean(x.display_name)}</h2><span class="status ${x.status==='pending'?'pendente':x.status==='approved'?'aprovado':x.status==='rejected'?'reprovado':'rascunho'}">${label(x.status)}</span></div><div class="panel"><dl class="detail">${fields.map(([k,v])=>`<div><dt>${k}</dt><dd>${clean(v||'—')}</dd></div>`).join('')}</dl><h3>Documentos</h3>${docs?`<ul class="history">${docs}</ul>`:'<p class="muted">Nenhum documento.</p>'}${mine?`<form id="decision-form"><div class="field"><label for="decision-note">Comentário da decisão</label><textarea id="decision-note" name="note" placeholder="Obrigatório se reprovar"></textarea></div><div class="actions"><button class="btn" type="submit" name="decision" value="approved">Aprovar</button><button class="btn danger" type="submit" name="decision" value="rejected">Reprovar</button></div></form>`:''}<h3>Histórico</h3>${events?`<ul class="history">${events}</ul>`:'<p class="muted">Ainda sem movimentações.</p>'}</div>`,'Detalhes do protocolo','finance');
    const form=app.querySelector('#decision-form');if(form)form.addEventListener('submit',decide);
  }
  function approvals(){if(!state.profile.can_financeiro||!['approver','admin'].includes(state.profile.role)){state.view='home';home();return;}
    const pending=state.items.filter(x=>x.status==='pending'&&x.approver_id===state.profile.id);
    shell(`<p class="intro">Protocolos aguardando sua decisão.</p><div class="panel tablewrap">${pending.length?`<table class="table"><thead><tr><th>Protocolo</th><th>Nome</th><th>Venc.</th><th>Valor</th><th></th></tr></thead><tbody>${pending.map(x=>`<tr><td>${clean(x.display_name)}</td><td>${clean(x.name)}</td><td>${date(x.due_date)}</td><td>${money(x.amount)}</td><td><button data-open="${clean(x.id)}">Analisar →</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty">Nenhum protocolo aguardando sua aprovação.</div>'}</div>`,'Aprovações','approvals');
  }
  function users(){if(state.profile.role!=='admin'){home();return;}
    shell(`<p class="intro">Contas novas aguardam liberação. Defina os módulos e o perfil de cada pessoa.</p><div class="panel tablewrap"><table class="table"><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Obras</th><th>Financeiro</th><th>Ativo</th><th>Ação</th></tr></thead><tbody>${state.users.map(u=>`<tr><td>${clean(u.full_name)}</td><td>${clean(u.email)}</td><td><select data-role="${clean(u.id)}" ${u.id===state.profile.id?'disabled':''}>${['requester','approver','finance','admin'].map(r=>`<option value="${r}" ${u.role===r?'selected':''}>${roleName(r)}</option>`).join('')}</select></td><td><input type="checkbox" data-obras="${clean(u.id)}" ${u.can_obras?'checked':''} ${u.id===state.profile.id?'disabled':''} aria-label="Obras: ${clean(u.full_name)}"></td><td><input type="checkbox" data-financeiro="${clean(u.id)}" ${u.can_financeiro?'checked':''} ${u.id===state.profile.id?'disabled':''} aria-label="Financeiro: ${clean(u.full_name)}"></td><td><input type="checkbox" data-active="${clean(u.id)}" ${u.active?'checked':''} ${u.id===state.profile.id?'disabled':''} aria-label="Ativo: ${clean(u.full_name)}"></td><td><button data-save-user="${clean(u.id)}" ${u.id===state.profile.id?'disabled':''}>Salvar</button></td></tr>`).join('')}</tbody></table></div>`,'Usuários','users');
  }
  function render(){if(!configured){app.innerHTML='<div class="authbox" style="min-height:100vh"><div class="panel" style="max-width:560px"><div class="brand" style="color:#102b44">SEALT</div><h2>Configuração do portal pendente</h2><p>O layout e os fluxos estão preparados. Para ativar o login e os protocolos, configure o projeto Supabase no arquivo <strong>config.js</strong> e execute o esquema do banco.</p></div></div>';return;}
    if(!state.session){authScreen(state.view==='signup'?'signup':'login');return;}
    if(!state.profile){app.innerHTML='<div class="loading">Carregando seu perfil…</div>';return;}
    if(!state.profile.active){app.innerHTML='<div class="authbox" style="min-height:100vh"><div class="panel"><h2>Acesso desativado</h2><p>Procure o administrador do portal.</p><button class="btn" data-action="logout">Sair</button></div></div>';return;}
    ({home,works,finance,new:newForm,detail,approvals,users}[state.view]||home)();
  }
  async function loadProfile(){const rows=await guarded(()=>rest('portal_profiles',`?id=eq.${encodeURIComponent(state.session.user.id)}&select=*`));state.profile=rows?.[0]||null;if(!state.profile)throw new Error('Seu perfil ainda não foi criado. Entre novamente em instantes.');}
  async function loadItems(){state.items=await guarded(()=>rest('protocols','?select=*,protocol_documents(id,filename,path),protocol_events(id,action,note,created_at)&order=created_at.desc'));}
  async function loadUsers(){state.users=await guarded(()=>rest('portal_profiles','?select=id,full_name,email,role,active,can_obras,can_financeiro&order=full_name.asc'));}
  async function navigate(view){state.message='';if(view==='works'&&!state.profile.can_obras)return;if(['finance','new','detail','approvals'].includes(view)&&!state.profile.can_financeiro)return;if(view==='users'&&state.profile.role!=='admin')return;try{if(['finance','approvals'].includes(view))await loadItems();if(['new','users'].includes(view))await loadUsers();state.view=view;render();}catch(e){flash(e.message);}}
  async function submitProtocol(ev){ev.preventDefault();if(state.busy)return;state.busy=true;const button=ev.target.querySelector('button[type=submit]');button.disabled=true;button.textContent='Enviando…';const f=new FormData(ev.target);const files=[...ev.target.querySelector('#files').files];let record=null;let phase='validar os dados';
    try{
      if(!files.length)throw new Error('Anexe pelo menos um documento.');
      if(files.some(x=>x.size>10*1024*1024 || !['application/pdf','image/jpeg','image/png'].includes(x.type)))throw new Error('Use PDF, JPG ou PNG com até 10 MB por arquivo.');
      const amount=Number(f.get('amount'));if(!Number.isFinite(amount))throw new Error('Informe um valor válido.');
      const payload={entity:String(f.get('entity')).trim(),cost_center:String(f.get('cost_center')).trim(),name:String(f.get('name')).trim(),document_no:String(f.get('document_no')).trim(),issue_date:f.get('issue_date'),due_date:f.get('due_date'),amount,category:String(f.get('category')).trim(),protocol_type:String(f.get('protocol_type')).trim(),description:String(f.get('description')).trim(),notes:String(f.get('notes')).trim(),approver_id:f.get('approver_id'),requester_id:state.profile.id};
      phase='localizar ou criar o rascunho';
      const drafts=state.pendingRecord?[]:await guarded(()=>rest('protocols',`?requester_id=eq.${state.profile.id}&status=eq.draft&select=*`));
      const match=drafts.find(x=>x.issue_date===payload.issue_date && x.name.trim().toLowerCase()===payload.name.toLowerCase() && x.document_no.trim().toLowerCase()===payload.document_no.toLowerCase());
      record=state.pendingRecord || match || (await guarded(()=>rest('protocols','',{method:'POST',body:payload})))[0];state.pendingRecord=record;
      phase='consultar os anexos do rascunho';
      const existing=await guarded(()=>rest('protocol_documents',`?protocol_id=eq.${record.id}&select=filename,size_bytes`));
      for(const file of files){if(existing.some(d=>d.filename===file.name&&d.size_bytes===file.size))continue;const suffix=file.name.split('.').pop().toLowerCase();const path=`${record.id}/${crypto.randomUUID()}.${suffix}`;
        phase=`enviar o arquivo ${file.name}`;
        await guarded(()=>request(`/storage/v1/object/protocol-files/${path}`,{method:'POST',body:file,headers:{'Content-Type':file.type,'x-upsert':'false'}}));
        phase=`registrar o arquivo ${file.name}`;
        await guarded(()=>rest('protocol_documents','',{method:'POST',body:{protocol_id:record.id,filename:file.name,path,mime_type:file.type,size_bytes:file.size}}));
      }
      phase='encaminhar ao aprovador';
      await guarded(()=>rpc('submit_protocol',{p_id:record.id}));state.pendingRecord=null;await loadItems();state.view='finance';flash('Protocolo enviado ao aprovador.','success');
    }catch(e){inlineNotice(ev.target,`Falha ao ${phase}: ${e.message}${record?' O rascunho foi mantido; tente novamente nesta tela.':''}`);}
    finally{state.busy=false;button.disabled=false;button.textContent='Protocolar e enviar ao aprovador';}
  }
  async function decide(ev){ev.preventDefault();const decision=ev.submitter?.value;const note=String(new FormData(ev.target).get('note')||'').trim();if(decision==='rejected'&&!note){flash('Descreva o motivo da reprovação.');return;}
    if(!['approved','rejected'].includes(decision))return;
    try{await guarded(()=>rpc('decide_protocol',{p_id:state.current.id,p_decision:decision,p_note:note}));await loadItems();state.current=state.items.find(x=>x.id===state.current.id);flash(decision==='approved'?'Protocolo aprovado.':'Protocolo reprovado.','success');}
    catch(e){flash(e.message);}
  }
  function csvCell(value,numeric=false){let x=String(value??'');if(!numeric && /^[=+\-@\t\r]/.test(x))x="'"+x;return '"'+x.replace(/"/g,'""')+'"';}
  async function exportCsv(){try{await loadItems();const rows=state.items.filter(x=>x.status==='approved');if(!rows.length){flash('Não há protocolos aprovados para exportar.');return;}
      const columns=['ID','Nome do Protocolo','Venc.','Emissão','N° Docto/NF','Nome','Descrição','Valor','Observação','C. Custo','Categ.','Tipo de Protocolo','Entidades','Status','Aprovado em'];
      const data=rows.map(x=>[x.id,x.display_name,date(x.due_date),date(x.issue_date),x.document_no,x.name,x.description,String(x.amount).replace('.',','),x.notes,x.cost_center,x.category,x.protocol_type,x.entity,'APROVADO',stamp(x.decided_at)]);
      const csv='\uFEFF'+[columns,...data].map((row,index)=>row.map((v,i)=>csvCell(v,index>0&&i===7)).join(';')).join('\r\n');const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.download=`Protocolos_aprovados_${new Date().toISOString().slice(0,10)}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),5000);
    }catch(e){flash(e.message);}}
  document.addEventListener('click',async ev=>{
    const target=ev.target.closest('[data-view],[data-action],[data-open],[data-document],[data-save-user]');if(!target)return;
    if(target.dataset.view){await navigate(target.dataset.view);return;}
    if(target.dataset.open){state.current=state.items.find(x=>x.id===target.dataset.open);state.view='detail';state.message='';render();return;}
    if(target.dataset.document){try{const path=target.dataset.document;const data=await guarded(()=>request(`/storage/v1/object/sign/protocol-files/${path}`,{method:'POST',body:{expiresIn:60}}));window.open(url(`/storage/v1${data.signedURL}`),'_blank','noopener');}catch(e){flash(e.message);}return;}
    if(target.dataset.saveUser){const id=target.dataset.saveUser;const role=app.querySelector(`[data-role="${id}"]`).value;const active=app.querySelector(`[data-active="${id}"]`).checked;const can_obras=app.querySelector(`[data-obras="${id}"]`).checked;const can_financeiro=app.querySelector(`[data-financeiro="${id}"]`).checked;try{await guarded(()=>rest('portal_profiles',`?id=eq.${id}`,{method:'PATCH',body:{role,active,can_obras,can_financeiro}}));await loadUsers();flash('Permissão atualizada.','success');}catch(e){flash(e.message);}return;}
    const action=target.dataset.action;
    if(action==='logout'){try{await request('/auth/v1/logout',{method:'POST'});}catch{}storeSession(null);state.profile=null;state.view='login';state.message='';render();}
    if(action==='signup'||action==='login'){state.view=action;state.message='';render();}
    if(action==='reload')navigate('finance');
    if(action==='export')exportCsv();
  });
  async function init(){if(!configured){render();return;}try{state.session=JSON.parse(sessionStorage.getItem('sealt_session')||'null');}catch{storeSession(null);}
    if(state.session){try{if(state.session.expires_at && state.session.expires_at*1000<Date.now()+60000)await refresh();if(state.session)await loadProfile();}catch(e){storeSession(null);state.message={text:e.message,kind:'error'};}}
    render();
  }
  init();
})();
