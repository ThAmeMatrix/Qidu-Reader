import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (this.state.error) return <div className="boot-screen"><h1>书页暂时停住了</h1><p>请重新打开应用，已保存的阅读资料会保留。</p><button className="button secondary" onClick={() => window.location.reload()}>重新打开</button></div>;
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
