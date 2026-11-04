import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Calendar, Checkbox, Empty, Form, Input, Popconfirm, Segmented, Select, Space, Tag, message } from 'antd';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import zhCN from 'antd/es/calendar/locale/zh_CN';
import { Link, useSearchParams } from 'react-router';
import Drawer from '@/components/DraggableDrawer';
import Modal from '@/components/DraggableModal';
import { get, post, patch, errorMessage, errorStatus } from '@/features/workspaces/api';
type Person = { id: string; name: string; username: string };
type Event = { id: string; title: string; description: string; location: string; startAt: string; endAt: string;
  important: boolean; visibility: string; mine: boolean; version: number; ownerId: string; cancelledAt?: string;
  tableId?: string; recordId?: string; recordUrl?: string; myResponse?: string; people?: Person[];
  invitations: { userId: string; status: string }[]; reminders: { minutesBefore: number }[] };
type Draft = { id?: string; version?: number; title: string; description: string; location: string; startAt: string; endAt: string;
  important: boolean; visibility: string; invitees: string[]; reminders: number[]; tableId?: string; recordId?: string };
const responses: Record<string,string> = {PENDING:'待回复',ACCEPTED:'已接受',DECLINED:'已拒绝',TENTATIVE:'待定'};
const scopes: Record<string,string> = {PRIVATE:'仅自己',INVITEES:'发起人与受邀成员',PUBLIC:'全体成员可见'};
const localTime = (s: string) => dayjs(s).format('YYYY-MM-DDTHH:mm');
export default function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const eventId = params.get('event');
  const [anchor, setAnchor] = useState(() => dayjs()), [view, setView] = useState('month');
  const [events, setEvents] = useState<Event[]>([]), [detail, setDetail] = useState<Event>();
  const [draft, setDraft] = useState<Draft>(), [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState(''), [formError, setFormError] = useState(''), [busy, setBusy] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const seq = useRef(0), peopleSeq = useRef(0), key = useRef(crypto.randomUUID());
  const [knownPeople, setKnownPeople] = useState<Record<string,Person>>({});
  const start = view === 'month' ? anchor.startOf('month').locale('zh-cn').startOf('week') : view === 'week'
    ? anchor.startOf('day').subtract((anchor.day()+6)%7,'day') : anchor.startOf('day');
  const end = start.add(view === 'month' ? 42 : view === 'week' ? 7 : 1,'day');
  const from = start.toISOString(), to = end.toISOString();
  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const result = await get<{rows:Event[];truncated:boolean}>('/calendar/events?' + new URLSearchParams({from,to}));
      if (n !== seq.current) return;
      setEvents(result.rows); setTruncated(result.truncated); setError('');
      if (eventId) {
        const selected = await get<Event>('/calendar/events/' + eventId);
        if (n === seq.current) setDetail(selected);
      } else setDetail(undefined);
    } catch(e) { if(n === seq.current){ setError(errorMessage(e)); setDetail(undefined); setEvents([]); } }
  },[from,to,eventId]);
  useEffect(() => { const initial=setTimeout(()=>void load(),0); const timer = setInterval(() => void load(),5000);
    const currentSequence=seq;
    return () => { currentSequence.current++; clearTimeout(initial); clearInterval(timer); }; },[load]);
  const searchPeople = useCallback(async (keyword='') => {
    const n=++peopleSeq.current;
    try { const result=await get<Person[]>('/calendar/people?'+new URLSearchParams({keyword}));
      if(n===peopleSeq.current) { setKnownPeople(previous=>({...previous,...Object.fromEntries(result.map(person=>[person.id,person]))})); setPeople(result); }
    } catch(e) { if(n===peopleSeq.current) setFormError(errorMessage(e)); }
  },[]);
  const create = useCallback((at: string, link?: {tableId?:string;recordId?:string}) => {
    key.current=crypto.randomUUID(); setFormError('');
    setDraft({title:'',description:'',location:'',startAt:localTime(at),endAt:localTime(dayjs(at).add(1,'hour').toISOString()),
      important:false,visibility:'PRIVATE',invitees:[],reminders:[1440,60],...link});
    void searchPeople();
  },[searchPeople]);
  const linkedTable = params.get('table'), linkedRecord=params.get('record');
  useEffect(() => { if(linkedTable && linkedRecord) {
    const timer=setTimeout(()=>create(dayjs().add(1,'hour').startOf('hour').toISOString(),{tableId:linkedTable,recordId:linkedRecord}),0);
    return ()=>clearTimeout(timer);
  } },[linkedTable,linkedRecord,create]);
  const update = (values: Partial<Draft>) => { key.current=crypto.randomUUID(); setDraft(d=>d?{...d,...values}:d); };
  const save = async () => {
    if(!draft || busy) return;
    if(!draft.title.trim() || !draft.startAt || !draft.endAt || !dayjs(draft.startAt).isValid() ||
      !dayjs(draft.endAt).isAfter(dayjs(draft.startAt))) {setFormError('请填写标题和有效时间，结束时间必须晚于开始时间。');return;}
    setBusy(true);
    try {
      const {id,...data}=draft;
      const payload={...data,startAt:dayjs(data.startAt).toISOString(),endAt:dayjs(data.endAt).toISOString()};
      const result=id ? await patch<Event>('/calendar/events/'+id,payload,key.current)
        : await post<Event>('/calendar/events',payload,key.current);
      setDraft(undefined);setParams({event:result.id}); message.success('日程已保存'); await load();
    } catch(e){setFormError(errorMessage(e));if(errorStatus(e))key.current=crypto.randomUUID();}
    finally{setBusy(false);}
  };
  const onDay = (date: dayjs.Dayjs) => events.filter(e=>dayjs(e.startAt).isBefore(date.add(1,'day').startOf('day')) && dayjs(e.endAt).isAfter(date.startOf('day')));
  const card = (event: Event) => <Button key={event.id} type="text" block style={{height:'auto',textAlign:'left',whiteSpace:'normal'}}
    onClick={e=>{e.stopPropagation();setParams({event:event.id});}}>
    {event.important && '★ '}{dayjs(event.startAt).format('HH:mm')} {event.title}
    {event.myResponse && <Tag>{responses[event.myResponse]}</Tag>}
  </Button>;
  const days=useMemo(()=>Array.from({length:view==='week'?7:1},(_,i)=>dayjs(from).add(i,'day')),[from,view]);
  return <div className="unified-area-page">
    <div className="unified-area-heading"><h1>协同日历</h1><Space wrap>
      <Button type="primary" onClick={()=>create(anchor.startOf('day').hour(9).toISOString())}>新建日程</Button>
      <Link to="/notifications">查看邀请与提醒</Link></Space></div>
    <p>记录重要事项，邀请同事参与；站内通知与在线弹窗提醒会发给发起人和已接受邀请的成员。</p>
    {error && <Alert type="error" title={error} action={<Button onClick={()=>void load()}>重试</Button>}/>}
    {truncated && <Alert type="warning" title="此时段超过500项，请切换周或日视图查看完整日程。"/>}
    <Space wrap style={{marginBottom:16}}>
      <Segmented aria-label="日历视图" value={view} onChange={setView} options={[{value:'day',label:'日'},{value:'week',label:'周'},{value:'month',label:'月'}]}/>
      <Button onClick={()=>setAnchor(d=>d.subtract(1,view as 'day'|'week'|'month'))}>上一{view==='month'?'月':view==='week'?'周':'日'}</Button>
      <Button onClick={()=>setAnchor(dayjs())}>今天</Button>
      <Button onClick={()=>setAnchor(d=>d.add(1,view as 'day'|'week'|'month'))}>下一{view==='month'?'月':view==='week'?'周':'日'}</Button>
      <Input aria-label="日历日期" type="date" value={anchor.format('YYYY-MM-DD')} onChange={e=>{if(e.target.value)setAnchor(dayjs(e.target.value));}}/>
      <Button onClick={()=>void load()}>刷新日程</Button>
    </Space>
    {view==='month' ? <Calendar locale={zhCN} value={anchor.locale('zh-cn')} onSelect={d=>setAnchor(d)}
      headerRender={()=> <h2>{anchor.format('YYYY年MM月')}</h2>}
      cellRender={(d,info)=>info.type==='date'?<div>{onDay(d).slice(0,3).map(card)}{onDay(d).length>3 &&
        <Button size="small" onClick={()=>{setAnchor(d);setView('day');}}>查看当日全部</Button>}</div>:info.originNode}/>
      : <div style={{display:'grid',gridTemplateColumns:`repeat(${days.length},minmax(160px,1fr))`,overflowX:'auto'}}>
        {days.map(d=><section key={d.toISOString()} style={{border:'1px solid #eee',minHeight:360,padding:12}}>
          <h3>{d.format('MM月DD日')}</h3>{onDay(d).map(card)}{!onDay(d).length&&<Empty description="暂无日程"/>}
          <Button onClick={()=>create(d.hour(9).toISOString())}>添加当日事项</Button></section>)}</div>}
    <Drawer title="日程详情" width={560} open={!!detail && !!eventId} onClose={()=>setParams({})}>
      {detail && <>
        <h2>{detail.important && '★ '}{detail.title}</h2>
        {detail.cancelledAt && <Alert type="warning" title="此日程已取消"/>}
        <p>{dayjs(detail.startAt).format('YYYY-MM-DD HH:mm')} 至 {dayjs(detail.endAt).format('YYYY-MM-DD HH:mm')}</p>
        <p>地点：{detail.location || '未填写'}</p><p>可见范围：{scopes[detail.visibility]}</p>
        <p style={{whiteSpace:'pre-wrap'}}>{detail.description}</p>
        {detail.recordUrl ? <Link to={detail.recordUrl}>打开关联业务记录</Link> : detail.recordId && <p>关联记录已删除或你无权查看。</p>}
        <h3>参与成员</h3><p>发起人：{detail.people?.find(p=>p.id===detail.ownerId)?.name || '已离职成员'}</p>
        {detail.invitations.map(i=><p key={i.userId}>{detail.people?.find(p=>p.id===i.userId)?.name || '已离职成员'} <Tag>{responses[i.status]}</Tag></p>)}
        <p>提醒：{detail.reminders.length?detail.reminders.map(r=>r.minutesBefore?'提前'+r.minutesBefore+'分钟':'开始时').join('、'):'不提醒'}</p>
        {detail.myResponse && !detail.cancelledAt && <Space wrap>{['ACCEPTED','DECLINED','TENTATIVE'].map(status=><Button key={status}
          disabled={busy || detail.myResponse===status} onClick={async()=>{setBusy(true);try{await post('/calendar/events/'+detail.id+'/respond',{status,version:detail.version});await load();}
            catch(e){setError(errorMessage(e));}finally{setBusy(false);}}}>{responses[status]}</Button>)}</Space>}
        {detail.mine && !detail.cancelledAt && <Space style={{marginTop:16}}><Button onClick={()=>{
          key.current=crypto.randomUUID();setFormError('');setPeople(detail.people || []);
          setKnownPeople(previous=>({...previous,...Object.fromEntries((detail.people || []).map(person=>[person.id,person]))}));
          setDraft({id:detail.id,version:detail.version,title:detail.title,description:detail.description,location:detail.location,
            startAt:localTime(detail.startAt),endAt:localTime(detail.endAt),important:detail.important,visibility:detail.visibility,
            invitees:detail.invitations.map(i=>i.userId),reminders:detail.reminders.map(r=>r.minutesBefore),tableId:detail.tableId||undefined,recordId:detail.recordId||undefined});
        }}>编辑日程</Button><Popconfirm title="取消日程并通知受邀成员？" onConfirm={async()=>{
          try{await post('/calendar/events/'+detail.id+'/cancel',{version:detail.version});await load();}catch(e){setError(errorMessage(e));}
        }}><Button danger>取消日程</Button></Popconfirm></Space>}
      </>}
    </Drawer>
    <Modal title={draft?.id?'编辑日程':'新建日程'} open={!!draft} width={680} confirmLoading={busy} okText="保存日程" cancelText="取消"
      onOk={()=>void save()} onCancel={()=>{if(!busy){setDraft(undefined);if(linkedRecord)setParams({});}}}>
      {draft && <Form layout="vertical" disabled={busy}>
        {formError && <Alert type="error" title={formError}/>}
        <Form.Item label="日程标题" required><Input aria-label="日程标题" maxLength={200} value={draft.title} onChange={e=>update({title:e.target.value})}/></Form.Item>
        <Form.Item label="开始时间" required><Input aria-label="开始时间" type="datetime-local" value={draft.startAt} onChange={e=>update({startAt:e.target.value})}/></Form.Item>
        <Form.Item label="结束时间" required><Input aria-label="结束时间" type="datetime-local" value={draft.endAt} onChange={e=>update({endAt:e.target.value})}/></Form.Item>
        <Form.Item label="地点"><Input value={draft.location} maxLength={300} onChange={e=>update({location:e.target.value})}/></Form.Item>
        <Form.Item label="事项说明"><Input.TextArea value={draft.description} maxLength={5000} onChange={e=>update({description:e.target.value})}/></Form.Item>
        <Form.Item><Checkbox checked={draft.important} onChange={e=>update({important:e.target.checked})}>标记为重要事项</Checkbox></Form.Item>
        <Form.Item label="可见范围"><Select aria-label="可见范围" value={draft.visibility} onChange={visibility=>update({visibility})} options={Object.entries(scopes).map(([value,label])=>({value,label}))}/></Form.Item>
        <Form.Item label="邀请成员" extra="修改日程时间后，受邀成员需重新确认。私人日程不能邀请其他人。">
          <Select aria-label="邀请成员" mode="multiple" showSearch filterOption={false} value={draft.invitees}
            onSearch={s=>void searchPeople(s)} onOpenChange={open=>{if(open)void searchPeople();}}
            onChange={invitees=>update({invitees,visibility:invitees.length&&draft.visibility==='PRIVATE'?'INVITEES':draft.visibility})}
            options={[...new Map([...people,...draft.invitees.flatMap(id=>knownPeople[id]?[knownPeople[id]]:[])].map(p=>[p.id,p])).values()].map(p=>({value:p.id,label:`${p.name} (${p.username})`}))}/></Form.Item>
        <Form.Item label="提醒时间（可多选）" extra="离线期间到期的提醒会补发；仅发给发起人和已接受邀请的成员。">
          <Select aria-label="提醒时间" mode="multiple" value={draft.reminders} onChange={reminders=>update({reminders})}
            options={[{value:0,label:'开始时'},{value:5,label:'提前5分钟'},{value:15,label:'提前15分钟'},{value:30,label:'提前30分钟'},
              {value:60,label:'提前1小时'},{value:1440,label:'提前1天'},{value:2880,label:'提前2天'},{value:10080,label:'提前1周'}]}/></Form.Item>
        {draft.recordId && <p>已关联表格中的业务记录。<Button type="link" onClick={()=>update({tableId:undefined,recordId:undefined})}>解除关联</Button></p>}
      </Form>}
    </Modal>
  </div>;
}
