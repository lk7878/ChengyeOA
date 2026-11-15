"""Arithmetic support only: does not validate evidence or applicability of a model."""
import argparse
import json
import math

def number(x, name, positive=False):
    x=float(x)
    if not math.isfinite(x) or (x<=0 if positive else x<0):
        raise ValueError(f'{name} must be finite and '+('positive' if positive else 'nonnegative'))
    return x

def distance_time(distance_m, duration_s):
    s=number(distance_m,'distance_m');t=number(duration_s,'duration_s',True)
    return {'quantity':'average_speed_over_interval','distance_m':s,'duration_s':t,'speed_m_s':s/t,'speed_km_h':3.6*s/t}

def frames(distance_m, first, last, fps, verified_cfr=False):
    if not verified_cfr:raise ValueError('frame timing and constant frame rate must be verified first')
    if isinstance(first,bool) or isinstance(last,bool) or not isinstance(first,int) or not isinstance(last,int) or first<0 or last<=first:
        raise ValueError('frame indices must be nonnegative integers with last > first')
    f=number(fps,'fps',True);n=last-first
    result=distance_time(distance_m,n/f)
    return {**result,'first_frame':first,'last_frame':last,'frame_intervals':n,'fps':f}

def bounds(distance_min_m,distance_max_m,time_min_s,time_max_s):
    lo=number(distance_min_m,'distance_min_m');hi=number(distance_max_m,'distance_max_m')
    tlo=number(time_min_s,'time_min_s',True);thi=number(time_max_s,'time_max_s',True)
    if hi<lo or thi<tlo:raise ValueError('bounds must be ordered')
    return {'quantity':'conservative_average_speed_bounds','lower_km_h':3.6*lo/thi,'upper_km_h':3.6*hi/tlo,'bound_type':'closed_input_bounds','note':'Not a statistical confidence interval; input bounds require evidence.'}

def constant_deceleration(terminal_km_h,deceleration_m_s2,distance_m):
    v=number(terminal_km_h,'terminal_km_h')/3.6;a=number(deceleration_m_s2,'deceleration_m_s2');s=number(distance_m,'distance_m')
    initial=math.sqrt(v*v+2*a*s)
    return {'quantity':'segment_initial_speed_under_constant_deceleration','initial_km_h':3.6*initial,'terminal_km_h':v*3.6,'deceleration_m_s2':a,'distance_m':s,'note':'Constant deceleration over this segment assumed; not automatically pre-avoidance or collision speed.'}

def main():
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='method',required=True)
    q=sub.add_parser('distance-time');q.add_argument('--distance-m',required=True,type=float);q.add_argument('--duration-s',required=True,type=float)
    q=sub.add_parser('frames');q.add_argument('--distance-m',required=True,type=float);q.add_argument('--first',required=True,type=int);q.add_argument('--last',required=True,type=int);q.add_argument('--fps',required=True,type=float);q.add_argument('--verified-cfr',action='store_true')
    q=sub.add_parser('bounds')
    for field in ['distance-min-m','distance-max-m','time-min-s','time-max-s']:q.add_argument('--'+field,required=True,type=float)
    q=sub.add_parser('constant-deceleration');q.add_argument('--terminal-km-h',required=True,type=float);q.add_argument('--deceleration-m-s2',required=True,type=float);q.add_argument('--distance-m',required=True,type=float)
    a=p.parse_args()
    try:
        if a.method=='distance-time':r=distance_time(a.distance_m,a.duration_s)
        elif a.method=='frames':r=frames(a.distance_m,a.first,a.last,a.fps,a.verified_cfr)
        elif a.method=='bounds':r=bounds(a.distance_min_m,a.distance_max_m,a.time_min_s,a.time_max_s)
        else:r=constant_deceleration(a.terminal_km_h,a.deceleration_m_s2,a.distance_m)
        print(json.dumps(r,ensure_ascii=False,indent=2,allow_nan=False))
    except ValueError as exc:p.error(str(exc))

if __name__=='__main__':main()
