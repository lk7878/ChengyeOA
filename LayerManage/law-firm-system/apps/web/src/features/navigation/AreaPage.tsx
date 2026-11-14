import { useState } from 'react';
import { Empty, Input } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import { Link } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import { areas, visibleEntries, type Area } from './catalog';

export default function AreaPage({ area: id }: { area: Area }) {
  const [query, setQuery] = useState('');
  const authorization = useAuthStore((state) => state.authorization);
  const name = useAuthStore((state) => state.userInfo?.name || state.userInfo?.username);
  const area = areas.find((item) => item.id === id)!;
  const available = visibleEntries(authorization, id).filter(
    (item) => item.path !== area.path && (item.title + item.group).includes(query.trim()),
  );
  const groups = [...new Set(available.map((item) => item.group))];
  return (
    <div className="unified-area-page">
      <div className="unified-area-heading">
        <div>
          <p className="unified-eyebrow">{id === 'home' ? `${name || '你'}的协作空间` : '组织协作'}</p>
          <h1>{area.title}</h1>
          <p>{area.description}</p>
        </div>
        <Input.Search
          aria-label="查找当前区域入口"
          placeholder="查找当前区域入口"
          allowClear
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {id === 'home' && !query && (
        <section className="unified-home-callout">
          <div>
            <h2>从一份共同的表格开始</h2>
            <p>在云盘中打开团队资源，继续处理自己的记录和待办。</p>
          </div>
          <Link to="/workspaces">
            进入云盘 <ArrowRightOutlined aria-hidden="true" />
          </Link>
        </section>
      )}
      {groups.map((group) => (
        <section key={group} className="unified-app-group">
          <h2>{group}</h2>
          <div className="unified-app-grid">
            {available
              .filter((item) => item.group === group)
              .map((item) => (
                <Link className="unified-app-card" to={item.path} key={item.path}>
                  <span className={'unified-card-symbol unified-symbol-' + id}>{item.title.slice(0, 1)}</span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{group}</small>
                  </span>
                  <ArrowRightOutlined aria-hidden="true" />
                </Link>
              ))}
          </div>
        </section>
      ))}
      {!available.length && <Empty description={query ? '没有匹配的可用入口' : '当前区域暂无已授权应用'} />}
    </div>
  );
}
