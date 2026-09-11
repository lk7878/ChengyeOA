import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import type { PropsWithChildren } from 'react';
dayjs.locale('zh-cn');

export default function ChineseConfig({ children }: PropsWithChildren) {
  return <ConfigProvider locale={zhCN}>{children}</ConfigProvider>;
}
