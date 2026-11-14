import { Navigate, useSearchParams } from 'react-router';

export default function VisitCalendarPage() {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.set('type', 'VISIT');
  return <Navigate replace to={'/calendar?' + next.toString()} />;
}
