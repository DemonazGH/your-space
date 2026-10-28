export const API_URL='https://personal-guide-api.your-space.workers.dev';
export const TIME_ZONE='Europe/Minsk';
export function hasTelegramLaunch(location=globalThis.location){
  // Inspect parameter names only; never copy launch credentials into another URL.
  return Boolean(location&&[location.search,location.hash].some(part=>typeof part==='string'&&/(?:^|[?&#])tgWebApp(?:Data|Version)=/.test(part)));
}

export function escapeHTML(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function validateEvent(draft){
  const title=typeof draft?.title==='string'?draft.title.trim():'';
  const date=typeof draft?.date==='string'?draft.date:'';
  const time=typeof draft?.time==='string'?draft.time:'';
  const errors={};
  if(!title||title.length>140)errors.title='title';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<'0001-01-01'||!Number.isFinite(Date.parse(`${date}T12:00:00Z`))||new Date(`${date}T12:00:00Z`).toISOString().slice(0,10)!==date)errors.date='date';
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))errors.time='time';
  return {valid:Object.keys(errors).length===0,errors,value:{title,date,time}};
}
export function sortEvents(events){return [...events].sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||a.id.localeCompare(b.id));}
export function minskToday(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const get=type=>parts.find(p=>p.type===type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export class PlansError extends Error{constructor(code,status=0){super(code);this.name='PlansError';this.code=code;this.status=status;}}
export function readSnapshot(data){
  if(!data||!['participant','test'].includes(data.mode)||!Number.isSafeInteger(data.revision)||data.revision<0||typeof data.consent!=='boolean'||data.timeZone!==TIME_ZONE||!Array.isArray(data.events))throw new PlansError('response');
  const ids=new Set();
  const events=data.events.map(event=>{
    if(!event||typeof event.id!=='string'||!event.id||event.id.length>128||ids.has(event.id)||!validateEvent(event).valid||typeof event.createdAt!=='string'||typeof event.updatedAt!=='string')throw new PlansError('response');
    ids.add(event.id);
    return {id:event.id,...validateEvent(event).value,createdAt:event.createdAt,updatedAt:event.updatedAt};
  });
  return {mode:data.mode,revision:data.revision,consent:data.consent,events:sortEvents(events),timeZone:TIME_ZONE};
}
const sameEvent=(event,draft)=>event.title===draft.title&&event.date===draft.date&&event.time===draft.time;

// Authentication and all event data live only in this instance, never browser storage.
export class PlansStore{
  #initData;#fetch;#onChange;#timeoutMs;#trash=new Map();
  constructor({initData='',telegramLaunchDetected=false,fetchImpl=globalThis.fetch,onChange=()=>{},timeoutMs=20000}={}){
    this.#initData=typeof initData==='string'?initData.trim():'';
    // Native browser fetch requires its global receiver, not this PlansStore.
    this.#fetch=(...args)=>Reflect.apply(fetchImpl,globalThis,args);this.#onChange=onChange;this.#timeoutMs=timeoutMs;this.demo=!this.#initData&&!telegramLaunchDetected;
    this.mode=this.demo?'demo':null;this.revision=0;this.consent=this.demo;this.events=[];this.timeZone=TIME_ZONE;
    this.pending=false;this.operation='';this.hasSnapshot=this.demo;this.needsRefresh=false;this.error=null;this.lastAction=null;
  }
  #emit(){this.#onChange(this);}
  #accept(snapshot){Object.assign(this,snapshot);this.hasSnapshot=true;this.needsRefresh=false;this.error=null;}
  async #request(method,path,body){
    const controller=typeof AbortController==='function'?new AbortController():null;
    let timeout;
    const timedOut=new Promise((_,reject)=>{timeout=setTimeout(()=>{controller?.abort();reject(new PlansError('network'));},this.#timeoutMs);});
    const request=async()=>{
      let response;
      try{response=await this.#fetch(`${API_URL}${path}`,{method,headers:{Authorization:`tma ${this.#initData}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),...(controller?{signal:controller.signal}:{}),cache:'no-store',credentials:'omit',redirect:'error'});}
      catch{throw new PlansError('network');}
      if(!response.ok){
        let code=({401:'auth',403:'forbidden',409:'conflict',413:'too_large',429:'rate',502:'storage',503:'storage'})[response.status]||'request';
        if(response.status===400){try{if((await response.json())?.error==='limit_reached')code='limit';}catch{}}
        throw new PlansError(code,response.status);
      }
      let data;try{data=await response.json();}catch{throw new PlansError('response');}
      return readSnapshot(data);
    };
    try{return await Promise.race([request(),timedOut]);}finally{clearTimeout(timeout);}
  }
  async load(){
    if(this.pending)throw new PlansError('busy');
    if(this.demo){this.#emit();return this;}
    if(!this.#initData){this.error=new PlansError('telegram');this.error.stage='initial_load';this.needsRefresh=true;this.#emit();throw this.error;}
    this.pending=true;this.operation='load';this.error=null;this.#emit();
    try{
      const snapshot=await this.#request('GET','/plans');
      if(this.hasSnapshot&&snapshot.revision<this.revision)throw new PlansError('response');
      this.#accept(snapshot);return this;
    }catch(error){
      this.error=error instanceof PlansError?error:new PlansError('network');
      this.error.stage=this.hasSnapshot?'refresh':'initial_load';
      this.needsRefresh=true;throw this.error;
    }
    finally{this.pending=false;this.operation='';this.#emit();}
  }
  async #mutate(method,path,body,effect,operation,demoChange){
    if(this.pending)throw new PlansError('busy');
    if(!this.hasSnapshot||this.needsRefresh)throw new PlansError('refresh');
    this.pending=true;this.operation=operation;this.error=null;this.lastAction=null;this.#emit();
    try{
      if(this.demo){demoChange();this.revision++;this.events=sortEvents(this.events);}
      else{
        const oldRevision=this.revision;
        const snapshot=await this.#request(method,path,{revision:oldRevision,consent:true,...body});
        if(snapshot.revision<=oldRevision||!effect(snapshot.events))throw new PlansError('response');
        this.#accept(snapshot);
      }
      this.lastAction=operation;return this;
    }catch(error){
      this.error=error instanceof PlansError?error:new PlansError('network');
      this.error.stage=operation;
      if(!this.demo)this.needsRefresh=true;
      throw this.error;
    }finally{this.pending=false;this.operation='';this.#emit();}
  }
  async save(draft,{id=null,consent=false}={}){
    const checked=validateEvent(draft);if(!checked.valid)throw new PlansError('validation');
    if(!this.demo&&!this.consent&&consent!==true)throw new PlansError('consent');
    if(id&&!this.events.some(e=>e.id===id))throw new PlansError('missing');
    const value=checked.value,oldIds=new Set(this.events.map(e=>e.id));
    return this.#mutate(id?'PATCH':'POST',id?`/plans/events/${encodeURIComponent(id)}`:'/plans/events',value,events=>events.some(e=>(id?e.id===id:!oldIds.has(e.id))&&sameEvent(e,value)),'save',()=>{
      const stamp=new Date().toISOString();
      if(id)this.events=this.events.map(e=>e.id===id?{...e,...value,updatedAt:stamp}:e);
      else this.events=[...this.events,{id:globalThis.crypto?.randomUUID?.()||`local-${Date.now()}-${Math.random().toString(16).slice(2)}`,...value,createdAt:stamp,updatedAt:stamp}];
    });
  }
  async remove(id){
    const event=this.events.find(e=>e.id===id);if(!event)throw new PlansError('missing');
    return this.#mutate('DELETE',`/plans/events/${encodeURIComponent(id)}`,{},events=>!events.some(e=>e.id===id),'delete',()=>{this.#trash.set(id,event);this.events=this.events.filter(e=>e.id!==id);});
  }
  async restore(id){
    if(this.demo&&!this.#trash.has(id))throw new PlansError('missing');
    return this.#mutate('POST',`/plans/events/${encodeURIComponent(id)}/restore`,{},events=>events.some(e=>e.id===id),'restore',()=>{this.events=[...this.events,this.#trash.get(id)];this.#trash.delete(id);});
  }
}

const t=(lang,ru,en)=>lang==='en'?en:ru;
const icons={clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg>',refresh:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/></svg>',calendar:'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5" y="7" width="22" height="21" rx="4"/><path d="M10 4v7M22 4v7M5 14h22M11 20h4M18 20h3"/></svg>'};
export function errorMessage(error,lang){
  if(['initial_load','refresh'].includes(error?.stage)){
    const initial=error.stage==='initial_load';
    const loadMessages={
      network:initial?
        ['Не удалось загрузить список. Проверь подключение к интернету и попробуй «Обновить список». Если не поможет, закрой страницу и открой её снова через Compass.','The list could not be loaded. Check your internet connection and try “Refresh list”. If that does not help, close this page and open it again through Compass.']:
        ['Не удалось обновить список. Показана последняя загруженная версия. Проверь подключение к интернету и попробуй обновить ещё раз.','The list could not be refreshed. The last loaded version is still shown. Check your internet connection and try refreshing again.'],
      storage:['Хранилище планов сейчас недоступно. Попробуй обновить список немного позже.','Plans storage is not available right now. Try refreshing the list a little later.'],
      response:['Ответ сервера получен, но прочитать список не удалось. Попробуй обновить список.','The server replied, but the list could not be read. Try refreshing the list.'],
      request:['Не удалось загрузить список с сервера. Попробуй обновить его немного позже.','The list could not be loaded from the server. Try refreshing it a little later.'],
      conflict:['Не удалось загрузить актуальную версию списка. Попробуй обновить список.','The latest version of the list could not be loaded. Try refreshing the list.'],
      rate:['Сейчас слишком много запросов. Подожди немного и попробуй обновить список.','Too many requests right now. Wait a little, then try refreshing the list.'],
      too_large:['Запрос списка не удалось выполнить. Попробуй обновить список или открыть его снова через Compass.','The list request could not be completed. Try refreshing the list or opening it again through Compass.']
    };
    if(loadMessages[error.code])return t(lang,...loadMessages[error.code]);
  }
  const messages={
    telegram:['Не удалось открыть список через Telegram. Закрой эту страницу и снова открой «Мои планы» через Compass.','The list could not be opened through Telegram. Close this page and open “My plans” again through Compass.'],
    auth:['Подключение Telegram истекло или не подтверждено. Закрой эту страницу и открой «Мои планы» снова через Compass.','Your Telegram connection has expired or could not be checked. Close this page and open “My plans” again through Compass.'],
    forbidden:['Этот Telegram-аккаунт не подключён к Compass. Открой Compass со своего подключённого аккаунта.','This Telegram account is not connected to Compass. Open Compass using your connected account.'],
    conflict:['Список уже изменился. Обнови его и проверь записи перед следующим сохранением. Поля формы оставлены без изменений.','The list has changed. Refresh it and check the items before saving again. Your form has been kept.'],
    storage:['Хранилище сейчас недоступно. Обнови список перед новой попыткой: результат последней операции нужно проверить. Поля формы сохранены в этой вкладке.','Storage is not available right now. Refresh the list before trying again to check the last action. Your form is kept in this tab.'],
    network:['Не удалось получить ответ сервера. Изменение могло сохраниться. Обнови список и проверь его перед новой попыткой. Поля формы остаются в этой вкладке.','There was no reply from the server. The change may have been saved. Refresh the list and check it before trying again. Your form stays in this tab.'],
    response:['Не удалось подтвердить результат. Обнови список и проверь записи. Поля формы остаются в этой вкладке.','The result could not be confirmed. Refresh the list and check the items. Your form stays in this tab.'],
    refresh:['Сначала обнови список. Это поможет проверить последние сохранённые записи.','Refresh the list first to check the latest saved items.'],
    request:['Не удалось выполнить действие. Обнови список перед новой попыткой. Поля формы остаются в этой вкладке.','The action could not be completed. Refresh the list before trying again. Your form stays in this tab.'],
    rate:['Сейчас слишком много запросов. Подожди немного и обнови список. Поля формы остаются в этой вкладке.','Too many requests right now. Wait a little, then refresh the list. Your form stays in this tab.'],
    too_large:['Этот запрос слишком большой. Обнови список и проверь поля перед новой попыткой.','This request is too large. Refresh the list and check the fields before trying again.'],
    limit:['В хранилище достигнут предел записей. Обратись к Дмитрию, чтобы разобраться с местом для новых планов.','Storage has reached its limit. Ask Dzmitry about making room for new plans.'],
    consent:['Перед первым сохранением нужно прочитать описание хранения и отметить согласие.','Before saving for the first time, read about storage and tick the consent box.'],
    missing:['Этого плана больше нет в загруженном списке. Проверь список; текст формы остаётся здесь.','This plan is no longer in the loaded list. Check the list; your form stays here.']
  };
  return t(lang,...(messages[error?.code]||messages.request));
}
export function safeErrorDetails(error){
  const stages=['initial_load','refresh','save','delete','restore'];
  const codes=['telegram','auth','forbidden','conflict','storage','network','response','refresh','request','rate','too_large','limit','consent','missing','validation','busy'];
  return {stage:stages.includes(error?.stage)?error.stage:'unknown',code:codes.includes(error?.code)?error.code:'unknown',httpStatus:Number.isInteger(error?.status)&&error.status>=100&&error.status<=599?error.status:0};
}
const disabled=flag=>flag?' disabled':'';
const escape=escapeHTML;
const draftMatches=(events,draft,id)=>events.some(event=>(!id||event.id===id)&&sameEvent(event,validateEvent(draft).value));
function readableDate(date,lang){
  const today=minskToday(),tomorrow=new Date(`${today}T12:00:00Z`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
  if(date===today)return t(lang,'Сегодня','Today');
  if(date===tomorrow.toISOString().slice(0,10))return t(lang,'Завтра','Tomorrow');
  return new Intl.DateTimeFormat(lang==='en'?'en-GB':'ru-RU',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));
}
function privacyHTML(store,lang){
  if(store.demo)return `<details class="privacy"><summary>${t(lang,'Как работает пробный режим','How the local try-out works')}</summary><p>${t(lang,'Планы живут только в памяти этой вкладки. Они не отправляются на сервер, не добавляются в анкету и не переносятся автоматически в рабочий список. Обновление или закрытие страницы очистит пробные записи.','Plans stay only in this tab’s memory. They are not sent to a server, added to the questionnaire or copied into the online list. Reloading or closing this page clears these items.')}</p></details>`;
  return `<details class="privacy"><summary>${t(lang,'Хранение, доступ и удаление','Storage, access and deleting')}</summary><p>${t(lang,'Планы сохраняются в закрытом хранилище Дмитрия через Cloudflare и GitHub. Дмитрий как владелец хранилища может их прочитать. Список отдельный: ответы анкеты не пополняются. Напоминаний об этих событиях сейчас нет.','Plans are saved in Dzmitry’s private storage through Cloudflare and GitHub. As the owner of the storage, Dzmitry can read them. This is a separate list: no answers are added to the questionnaire. There are no reminders for these events at the moment.')}</p><p>${t(lang,'Удаление убирает план из списка; его можно вернуть кнопкой «Вернуть». История хранилища может сохранять старые версии. Для полного удаления обратись к Дмитрию.','Deleting removes a plan from the list. You can bring it back with “Undo”. Storage history may keep older versions. Ask Dzmitry if you want a plan fully removed.')}</p></details>`;
}
function consentHTML(store,ui){
  if(store.demo||store.consent)return '';
  const lang=ui.lang;
  return `<div class="consent-box"><p>${t(lang,'Перед первым сохранением: планы попадут в закрытое хранилище Дмитрия через Cloudflare и GitHub. Дмитрий как владелец может их прочитать. Планы не добавляются в анкету; напоминаний об этих событиях сейчас нет.','Before your first save: plans will go to Dzmitry’s private storage through Cloudflare and GitHub. As its owner, Dzmitry can read them. Plans are not added to the questionnaire. There are no reminders for these events at the moment.')}</p><label class="check"><input type="checkbox" id="plans-consent"${ui.consentChecked?' checked':''}${disabled(store.pending)}><span>${t(lang,'Я понимаю, где хранятся планы и кто может их прочитать, и согласен сохранить их.','I understand where my plans are stored and who can read them, and I agree to save them.')}</span></label></div>`;
}
function renderForm(store,ui){
  const lang=ui.lang,errors=ui.fieldErrors||{};
  const fieldError=key=>errors[key]?`<span class="field-error" id="${key}-error">${t(lang,...({title:['Введи название от 1 до 140 символов.','Enter a title with 1 to 140 characters.'],date:['Выбери настоящую дату.','Choose a valid date.'],time:['Выбери время от 00:00 до 23:59.','Choose a time from 00:00 to 23:59.']}[key]))}</span>`:'';
  const attr=key=>errors[key]?` aria-invalid="true" aria-describedby="${key}-error"`:'';
  const confirmed=ui.uncertainSave&&store.hasSnapshot&&!store.needsRefresh&&draftMatches(store.events,ui.draft,ui.editId);
  const missing=ui.editId&&!store.events.some(e=>e.id===ui.editId);
  const locked=store.pending||store.needsRefresh||!store.hasSnapshot||missing||confirmed;
  return `<button type="button" class="back" id="cancel-top"${disabled(store.pending)}>← ${t(lang,'К списку','Back to list')}</button><section class="form-card" aria-labelledby="form-title"><div class="form-header"><h2 id="form-title" tabindex="-1">${ui.editId?t(lang,'Изменить план','Edit plan'):t(lang,'Новый план','New plan')}</h2><p>${t(lang,'Сохранение — только после нажатия кнопки.','Nothing is saved until you press the button.')}</p></div>${confirmed?`<div class="notice success"><p>${t(lang,'Такая запись есть в обновлённом списке. Можно вернуться к списку и проверить её. Повторное сохранение не требуется.','This item is in the refreshed list. You can return to the list and check it. You do not need to save it again.')}</p></div>`:''}${missing?`<div class="notice error"><p>${errorMessage(new PlansError('missing'),lang)}</p></div>`:''}<form id="plan-form" novalidate><div class="fields"><label class="field" for="plan-title"><span>${t(lang,'Название','Title')}</span><input id="plan-title" name="title" type="text" maxlength="140" required autocomplete="off" value="${escape(ui.draft.title)}"${attr('title')}${disabled(store.pending)}><span class="title-count" id="title-count">${ui.draft.title.length} / 140</span>${fieldError('title')}</label><div class="field-row"><label class="field" for="plan-date"><span>${t(lang,'Дата','Date')}</span><input id="plan-date" name="date" type="date" required value="${escape(ui.draft.date)}"${attr('date')}${disabled(store.pending)}>${fieldError('date')}</label><label class="field" for="plan-time"><span>${t(lang,'Время','Time')}</span><input id="plan-time" name="time" type="time" required value="${escape(ui.draft.time)}"${attr('time')}${disabled(store.pending)}>${fieldError('time')}</label></div></div>${consentHTML(store,ui)}<div class="form-actions"><button type="button" id="cancel-form"${disabled(store.pending)}>${t(lang,'Отмена','Cancel')}</button><button type="submit" class="primary" id="save-plan"${disabled(locked||(!store.demo&&!store.consent&&!ui.consentChecked))}>${store.pending&&store.operation==='save'?t(lang,'Сохраняем…','Saving…'):t(lang,'Сохранить','Save')}</button></div></form></section>`;
}
function renderList(store,ui){
  const lang=ui.lang,locked=store.pending||store.needsRefresh||!store.hasSnapshot;
  if(!store.hasSnapshot)return `<div class="loading-placeholder">${store.pending?t(lang,'Загружаем список…','Loading the list…'):t(lang,'Список пока не загружен.','The list has not loaded yet.')}</div>`;
  if(!store.events.length)return `<section class="empty"><div class="empty-icon">${icons.calendar}</div><h2>${t(lang,'Здесь будут твои планы','Your plans will appear here')}</h2><p>${t(lang,'Пока список пуст. Добавь план, когда захочешь: название, дату и время.','The list is empty for now. Add a plan when you want to: a title, date and time.')}</p></section>`;
  const groups=new Map();for(const event of sortEvents(store.events)){if(!groups.has(event.date))groups.set(event.date,[]);groups.get(event.date).push(event);}
  return `<div class="event-groups">${[...groups].map(([date,events])=>`<section aria-label="${escape(readableDate(date,lang))}"><h2 class="date-heading">${escape(readableDate(date,lang))}</h2><ul class="event-list">${events.map(event=>`<li class="event-card"><div class="event-top"><time class="event-time" datetime="${escape(event.date)}T${escape(event.time)}">${escape(event.time)}</time><h3 class="event-title">${escape(event.title)}</h3></div><div class="event-bottom"><span class="saved-label">${store.demo?t(lang,'В этой вкладке','In this tab'):t(lang,'В хранилище','In storage')}</span><div class="event-actions"><button type="button" data-edit="${escape(event.id)}"${disabled(locked)}>${t(lang,'Изменить','Edit')}</button><button type="button" class="delete-button" data-delete="${escape(event.id)}"${disabled(locked)}>${t(lang,'Удалить','Delete')}</button></div></div></li>`).join('')}</ul></section>`).join('')}</div>`;
}
function renderDelete(store,ui){
  if(!ui.deleteEvent)return '';
  const lang=ui.lang;
  return `<div class="overlay"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="delete-heading" aria-describedby="delete-description"><h2 id="delete-heading">${t(lang,'Удалить из списка?','Remove from the list?')}</h2><p class="delete-title">${escape(ui.deleteEvent.title)}</p><p id="delete-description">${store.demo?t(lang,'План исчезнет из этой вкладки. После удаления будет кнопка «Вернуть».','The plan will be removed from this tab. There will be an “Undo” button.'):t(lang,'План уберётся из списка. Его можно будет вернуть. История хранилища может сохранять старые версии.','The plan will be removed from the list. You will be able to undo this. Storage history may keep older versions.')}</p><div class="dialog-actions"><button id="cancel-delete"${disabled(store.pending)}>${t(lang,'Оставить','Keep it')}</button><button id="confirm-delete" class="danger"${disabled(store.pending)}>${store.pending?t(lang,'Удаляем…','Deleting…'):t(lang,'Удалить','Delete')}</button></div></section></div>`;
}
export function renderPlans(store,ui){
  const lang=ui.lang||'ru';
  let sync='';
  if(store.pending)sync=({load:t(lang,'Обновляем список…','Refreshing the list…'),save:t(lang,'Ждём подтверждения сохранения…','Waiting for the save to be confirmed…'),delete:t(lang,'Ждём подтверждения удаления…','Waiting for removal to be confirmed…'),restore:t(lang,'Восстанавливаем план…','Restoring the plan…')})[store.operation]||'';
  else if(store.needsRefresh&&store.hasSnapshot)sync=t(lang,'Показана ранее загруженная копия. Сначала обнови список.','This is the previously loaded copy. Refresh the list first.');
  else if(store.hasSnapshot)sync=store.demo?t(lang,'Пробные записи остаются только в памяти этой вкладки.','Try-out items stay only in this tab’s memory.'):t(lang,'Записи на экране загружены из закрытого хранилища.','The items on this screen were loaded from private storage.');
  const error=store.error||ui.error;
  const diagnostics=error?safeErrorDetails(error):null;
  const notice=error?`<div class="notice error" role="alert" data-error-stage="${diagnostics.stage}" data-error-code="${diagnostics.code}" data-http-status="${diagnostics.httpStatus}"><p>${escape(errorMessage(error,lang))}</p></div>`:ui.message?`<div class="notice success"><p>${escape(ui.message)}</p></div>`:'';
  const refreshButton=`<button class="refresh" id="refresh-list" type="button" title="${t(lang,'Обновить список','Refresh list')}" aria-label="${t(lang,'Обновить список','Refresh list')}"${disabled(store.pending)}>${icons.refresh}</button>`;
  const undo=ui.undoEvent?`<div class="notice success undo"><p>${t(lang,'План удалён из списка.','The plan was removed from the list.')}</p><button type="button" id="undo-delete"${disabled(store.pending||store.needsRefresh)}>${t(lang,'Вернуть','Undo')}</button></div>`:'';
  return `<div id="page-content"${ui.deleteEvent?' inert':''}><header><div class="brand"><span class="brand-mark" aria-hidden="true">↗</span><span>Compass</span></div><div class="languages" role="group" aria-label="${t(lang,'Язык','Language')}"><button type="button" data-lang="ru" aria-pressed="${lang==='ru'}"${disabled(store.pending)}>РУС</button><button type="button" data-lang="en" aria-pressed="${lang==='en'}"${disabled(store.pending)}>ENG</button></div></header><main><p class="eyebrow">${t(lang,'Твой список','Your own list')}</p><h1>${t(lang,'Мои планы','My plans')}</h1><p class="lead">${t(lang,'Ближайшие события и планы в одном месте.','Your upcoming events and plans in one place.')}</p><div class="timezone">${icons.clock}${t(lang,'Время по Минску','Times are in Minsk time')}</div>${store.demo?`<aside class="mode-note demo"><strong>${t(lang,'Локальный пробный режим','Local try-out mode')}</strong><p>${t(lang,'Данные только в памяти этой вкладки. Они исчезнут при обновлении или закрытии страницы и не отправятся на сервер.','Data stays only in this tab’s memory. Reloading or closing the page clears it. Nothing is sent to the server.')}</p></aside>`:store.mode==='test'?`<aside class="mode-note test"><strong>${t(lang,'Тестовый режим · отдельный список','Test mode · a separate list')}</strong><p>${t(lang,'Эти записи сохраняются отдельно от списка Артёма.','These items are saved separately from Artsiom’s list.')}</p></aside>`:''}<div class="toolbar">${ui.formOpen?`<span class="small">${t(lang,'Форма не сохраняется автоматически.','The form is not saved automatically.')}</span>`:`<button class="primary" id="add-plan" type="button"${disabled(store.pending||store.needsRefresh||!store.hasSnapshot)}><span class="plus" aria-hidden="true">+</span>${t(lang,'Добавить план','Add a plan')}</button>`}${refreshButton}</div>${notice}<p class="sync-state${store.pending?' busy':''}" role="status">${escape(sync)}</p>${undo}${ui.formOpen?renderForm(store,ui):renderList(store,ui)}${privacyHTML(store,lang)}<p class="footer-note">${t(lang,'Напоминания об этих событиях не отправляются.','No reminders are sent for these events.')}</p></main></div>${renderDelete(store,ui)}`;
}

export function mountPlans({root=document.querySelector('#app'),webApp=globalThis.Telegram?.WebApp,fetchImpl=globalThis.fetch}={}){
  const ui={lang:'ru',formOpen:false,editId:null,draft:{title:'',date:'',time:''},fieldErrors:{},consentChecked:false,error:null,message:'',deleteEvent:null,undoEvent:null,uncertainSave:false,uncertainDelete:null};
  let lastAnnouncement='';
  const announce=message=>{const node=document.querySelector('#announcer');if(node&&message&&message!==lastAnnouncement){node.textContent=message;lastAnnouncement=message;}};
  const store=new PlansStore({initData:webApp?.initData||'',telegramLaunchDetected:hasTelegramLaunch(),fetchImpl,onChange:()=>render()});
  function focus(id){root.querySelector(`#${id}`)?.focus();}
  function render(focusId){
    document.documentElement.lang=ui.lang;document.title=t(ui.lang,'Мои планы · Compass','My plans · Compass');
    root.innerHTML=renderPlans(store,ui);bind();
    if(focusId)focus(focusId);
    else if(ui.deleteEvent&&!store.pending)focus('cancel-delete');
    if(store.error||ui.error)announce(errorMessage(store.error||ui.error,ui.lang));
    else if(ui.message)announce(ui.message);
  }
  function clearForm(){ui.formOpen=false;ui.editId=null;ui.draft={title:'',date:'',time:''};ui.fieldErrors={};ui.consentChecked=false;ui.uncertainSave=false;}
  function openForm(event){
    if(store.pending||store.needsRefresh||!store.hasSnapshot)return;
    ui.formOpen=true;ui.editId=event?.id||null;ui.draft=event?{title:event.title,date:event.date,time:event.time}:{title:'',date:minskToday(),time:''};
    ui.fieldErrors={};ui.error=null;ui.message='';ui.uncertainSave=false;ui.consentChecked=false;render('plan-title');
  }
  async function refresh(){
    if(store.pending)return;ui.error=null;ui.message='';
    try{
      await store.load();
      if(ui.uncertainDelete){
        if(!store.events.some(event=>event.id===ui.uncertainDelete.id))ui.undoEvent=ui.uncertainDelete;
        ui.uncertainDelete=null;
      }
      if(ui.undoEvent&&store.events.some(event=>event.id===ui.undoEvent.id)){
        ui.undoEvent=null;ui.message=t(ui.lang,'План есть в обновлённом списке.','The plan is in the refreshed list.');
      }
      else if(ui.formOpen&&!ui.uncertainSave)ui.message=t(ui.lang,'Список обновлён. Поля формы оставлены без изменений.','The list has been refreshed. Your form has been kept.');
    }
    catch{}render();
  }
  function bind(){
    root.querySelectorAll('[data-lang]').forEach(button=>button.onclick=()=>{if(store.pending)return;ui.lang=button.dataset.lang;ui.message='';render();});
    const add=root.querySelector('#add-plan');if(add)add.onclick=()=>openForm();
    const refreshButton=root.querySelector('#refresh-list');if(refreshButton)refreshButton.onclick=refresh;
    for(const id of ['cancel-top','cancel-form']){const button=root.querySelector(`#${id}`);if(button)button.onclick=()=>{if(store.pending)return;clearForm();ui.error=null;ui.message='';render('add-plan');};}
    root.querySelectorAll('[data-edit]').forEach(button=>button.onclick=()=>openForm(store.events.find(event=>event.id===button.dataset.edit)));
    root.querySelectorAll('[data-delete]').forEach(button=>button.onclick=()=>{if(store.pending||store.needsRefresh)return;ui.error=null;ui.message='';ui.deleteEvent=store.events.find(event=>event.id===button.dataset.delete);render();});
    for(const key of ['title','date','time']){
      const input=root.querySelector(`#plan-${key}`);if(input)input.oninput=()=>{
        ui.draft[key]=input.value;ui.fieldErrors[key]=null;ui.uncertainSave=false;
        const counter=root.querySelector('#title-count');if(counter)counter.textContent=`${ui.draft.title.length} / 140`;
        const save=root.querySelector('#save-plan');if(save)save.disabled=store.pending||store.needsRefresh||(!store.demo&&!store.consent&&!ui.consentChecked)||(ui.editId&&!store.events.some(event=>event.id===ui.editId));
      };
    }
    const consent=root.querySelector('#plans-consent');if(consent)consent.onchange=()=>{ui.consentChecked=consent.checked;const save=root.querySelector('#save-plan');if(save)save.disabled=store.pending||store.needsRefresh||!consent.checked;};
    const form=root.querySelector('#plan-form');if(form)form.onsubmit=async event=>{
      event.preventDefault();if(store.pending||store.needsRefresh)return;
      const checked=validateEvent(ui.draft);ui.fieldErrors=checked.errors;ui.error=null;ui.message='';
      if(!checked.valid){render(`plan-${Object.keys(checked.errors)[0]}`);return;}
      if(ui.uncertainSave&&draftMatches(store.events,ui.draft,ui.editId)){render();return;}
      try{await store.save(ui.draft,{id:ui.editId,consent:ui.consentChecked});clearForm();ui.message=store.demo?t(ui.lang,'План добавлен в память этой вкладки.','The plan is kept in this tab’s memory.'):t(ui.lang,'План сохранён в закрытом хранилище.','The plan has been saved in private storage.');}
      catch(error){ui.error=error;if(['network','response','storage'].includes(error.code))ui.uncertainSave=true;}
      render(ui.formOpen?null:'add-plan');
    };
    const cancelDelete=root.querySelector('#cancel-delete');if(cancelDelete)cancelDelete.onclick=()=>{if(store.pending)return;ui.deleteEvent=null;render();};
    const confirmDelete=root.querySelector('#confirm-delete');if(confirmDelete)confirmDelete.onclick=async()=>{
      if(store.pending||store.needsRefresh)return;const event=ui.deleteEvent;ui.error=null;ui.message='';
      try{await store.remove(event.id);ui.undoEvent=event;}
      catch(error){ui.error=error;if(['network','response','storage'].includes(error.code))ui.uncertainDelete=event;}
      ui.deleteEvent=null;render();
    };
    const undoButton=root.querySelector('#undo-delete');if(undoButton)undoButton.onclick=async()=>{
      if(store.pending||store.needsRefresh)return;ui.error=null;ui.message='';
      try{await store.restore(ui.undoEvent.id);ui.undoEvent=null;ui.message=store.demo?t(ui.lang,'План возвращён в эту вкладку.','The plan is back in this tab.'):t(ui.lang,'План восстановлен в списке.','The plan has been restored to the list.');}
      catch(error){ui.error=error;}render();
    };
  }
  root.addEventListener('keydown',event=>{
    if(!ui.deleteEvent)return;
    if(event.key==='Escape'&&!store.pending){event.preventDefault();ui.deleteEvent=null;render();}
    if(event.key==='Tab'){
      const buttons=[...root.querySelectorAll('.dialog button:not(:disabled)')];if(!buttons.length){event.preventDefault();return;}
      const first=buttons[0],last=buttons.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  try{webApp?.ready?.();webApp?.expand?.();}catch{}
  render();if(!store.demo)void store.load().catch(()=>{});
  return {store,ui,refresh};
}

if(typeof document!=='undefined'&&document.querySelector('#app'))mountPlans();
