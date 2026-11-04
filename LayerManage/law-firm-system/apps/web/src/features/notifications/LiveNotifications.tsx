import { useEffect, useRef } from 'react';
import { notification } from 'antd';
import { useNavigate } from 'react-router';
import { notificationApi } from '@/api/organization';
import { useAuthStore } from '@/stores/authStore';
import { notificationTarget } from '@/pages/Notification/notification-target';

/** Poll only the notice stream; never refresh the user's active form/table. */
export default function LiveNotifications() {
  const userId = useAuthStore(s=>s.userInfo?.id), authorization = useAuthStore(s=>s.authorization);
  const [api, holder] = notification.useNotification();
  const navigate = useNavigate(), running = useRef(false);
  useEffect(()=>{
    if(!userId) return;
    let alive=true;
    const storageKey='oa-notice-seen:'+userId;
    let seen: string[]=[];
    try { const saved=JSON.parse(localStorage.getItem(storageKey)||'[]'); if(Array.isArray(saved))seen=saved.filter(v=>typeof v==='string'); } catch { /* Storage is optional. */ }
    const poll=async()=>{
      if(running.current) return;
      running.current=true;
      try {
        const result=await notificationApi.list({page:1,pageSize:100,isRead:'false'},{suppressGlobalError:true});
        if(!alive) return;
        const fresh=result.data.list.filter(row=>['MENTION','CALENDAR'].includes(row.type) && !seen.includes(row.id)).slice(0,3);
        for(const row of fresh){
          const route=notificationTarget(row,authorization);
          api.info({key:row.id,title:row.title,description:row.content,duration:0,
            onClick:()=>{if(route)navigate(route);api.destroy(row.id);void notificationApi.read(row.id).catch(()=>undefined);}});
          seen.push(row.id);
        }
        seen=seen.slice(-1000);
        try{localStorage.setItem(storageKey,JSON.stringify(seen));}catch{/* Keep in-memory deduplication. */}
      }catch{/* Durable notifications remain available in the notification center after retry. */}
      finally{running.current=false;}
    };
    void poll();const timer=setInterval(()=>void poll(),5000);
    window.addEventListener('focus',poll);
    return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',poll);api.destroy();};
  },[userId,authorization,api,navigate]);
  return holder;
}
