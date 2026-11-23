import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';

describe('App（路由 + 布局冒烟）', () => {
  it('默认跳转到 /admin/demo 并经 MSW 加载演示数据', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText('工作台演示（/admin/demo）')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('demo-member-list')).toBeInTheDocument());
    // 布局三要素：侧边栏导航 + 顶栏 + 内容
    expect(screen.getByText('会员列表')).toBeInTheDocument();
    expect(screen.getByText('标签树')).toBeInTheDocument();
    expect(screen.getByText(/全部数据为自拟虚构数据/)).toBeInTheDocument();
  });

  it('演示页合计储值以分计算（前 5 条之和 = 185175 分）', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('demo-total-balance')).toBeInTheDocument());
    // 12345+24690+37035+49380+61725 = 185175
    expect(screen.getByTestId('demo-total-balance').textContent).toBe('合计储值（分）：185175');
  });

  it('路由 /commission/rules 渲染佣金规则表页（#2370）', async () => {
    window.history.pushState({}, '', '/commission/rules');
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('commission-rules-page')).toBeInTheDocument());
    expect(screen.getByText('佣金规则表配置')).toBeInTheDocument();
    // 侧边栏导航含「佣金规则表」入口
    expect(screen.getByText('佣金规则表')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('rule-row-row-1')).toBeInTheDocument());
    window.history.pushState({}, '', '/');
  });
});
